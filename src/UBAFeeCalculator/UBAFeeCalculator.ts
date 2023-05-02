import { BigNumber } from "ethers";
import { UbaFlow, isUbaInflow, isUbaOutflow, UBAFeeResult, UBAFlowRange, UBASpokeBalanceType } from "../interfaces";
import UBAConfig from "./UBAFeeConfig";
import { getDepositBalancingFee, getRefundBalancingFee } from "./UBAFeeUtility";
import { toBN } from "../utils";
import { Logger } from "winston";

// This file holds the UBA Fee Calculator class. The goal of this class is to keep track
// of the running balance of a given spoke pool by fetching the most recent confirmed bundle
// and computing the inflows and outflows to find the running balance.
// The class can use this running balance to calculate the fee for a given action (request or refund)

/**
 * @file UBAFeeCalculator.ts
 * @description UBA Fee Calculator
 * @author Across Bots Team
 */
export default class UBAFeeCalculator {
  constructor(
    private readonly config: UBAConfig,
    private readonly logger: Logger,
    protected readonly originSpoke: UBASpokeBalanceType,
    protected readonly refundSpoke: UBASpokeBalanceType
  ) {
    this.logger.debug("UBA Fee Calculator initialized");
  }

  /**
   * @description Get the recent request flow
   * @param action The action to get the fee for
   * @returns The relevant fee
   */
  public async getUBAFee(amount: BigNumber, flowRange?: UBAFlowRange): Promise<UBAFeeResult> {
    // Get the origin and refund chain ids
    const originChain = this.originSpoke.chainId;
    const refundChain = this.refundSpoke.chainId;

    const refundRunningBalance = this.calculateRecentRunningBalance("refund", flowRange);
    const originRunningBalance = this.calculateRecentRunningBalance("origin", flowRange);

    let depositorFee = toBN(0);
    let refundFee = toBN(0);

    // Resolve the alpha fee of this action
    const alphaFee = this.config.getBaselineFee(originChain, refundChain);

    // Contribute the alpha fee to the LP fee
    depositorFee = depositorFee.add(alphaFee);

    // Resolve the utilization fee
    const utilizationFee = this.config.getUtilizationFee();

    // Contribute the utilization fee to the Relayer fee
    refundFee = refundFee.add(utilizationFee);

    // Resolve the balancing fee tuples that are relevant to this operation
    const originBalancingFeeTuples = this.config.getBalancingFeeTuples(originChain);
    const refundBalancingFeeTuples = this.config.getBalancingFeeTuples(refundChain);

    refundFee = refundFee.add(getRefundBalancingFee(refundBalancingFeeTuples, refundRunningBalance, amount));
    depositorFee = depositorFee.add(getDepositBalancingFee(originBalancingFeeTuples, originRunningBalance, amount));

    // Find the gas fee of this action in the refund chain
    // TODO: This value below is related to the gas fee

    return {
      depositorFee,
      refundFee,
      totalUBAFee: depositorFee.add(refundFee),
    };
  }

  public getHistoricalUBAFees(type: "refund" | "origin"): Promise<UBAFeeResult[]> {
    return Promise.all(
      (type === "refund" ? this.refundSpoke : this.originSpoke).recentRequestFlow.map((flow, idx) =>
        this.getUBAFee(flow.amount, { startIndex: 0, endIndex: idx })
      )
    );
  }

  /**
   * @description Get the running balance
   * @param type The type of running balance to get
   * @param flowRange The range of flows to use to calculate the running balance
   * @returns void
   * @protected
   * @method calculateRecentRunningBalance
   * @memberof UBAFeeCalculator
   */
  protected calculateRecentRunningBalance(type: "origin" | "refund", flowRange?: UBAFlowRange): BigNumber {
    // Reduce over the recent request flow and add the amount to
    // the last validated running balance. If there is no last validated running balance
    // then set the initial value to 0
    const fn = (flow: UbaFlow[], validatedRunningBalance?: BigNumber) =>
      flow.reduce((acc, flow) => {
        if (isUbaInflow(flow)) {
          return acc.add(toBN(flow.amount));
        } else if (isUbaOutflow(flow)) {
          return acc.sub(toBN(flow.amount));
        } else {
          return acc;
        }
      }, validatedRunningBalance ?? toBN(0));

    const spoke = type === "origin" ? this.originSpoke : this.refundSpoke;
    const flow = flowRange
      ? spoke.recentRequestFlow.slice(flowRange.startIndex, flowRange.endIndex)
      : spoke.recentRequestFlow;

    return fn(flow, spoke.lastValidatedRunningBalance);
  }
}