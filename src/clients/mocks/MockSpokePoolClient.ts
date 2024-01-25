import assert from "assert";
import { BigNumber, Contract, Event, providers } from "ethers";
import { random } from "lodash";
import winston from "winston";
import { ZERO_ADDRESS } from "../../constants";
import { DepositWithBlock, FillWithBlock, FundsDepositedEvent } from "../../interfaces";
import { bnZero, toBNWei, forEachAsync, getCurrentTime, randomAddress } from "../../utils";
import { SpokePoolClient, SpokePoolUpdate } from "../SpokePoolClient";
import { EventManager, EventOverrides, getEventManager } from "./MockEvents";

type Block = providers.Block;

// This class replaces internal SpokePoolClient functionality, enabling the
// user to bypass on-chain queries and inject ethers Event objects directly.
export class MockSpokePoolClient extends SpokePoolClient {
  public eventManager: EventManager;
  private realizedLpFeePct: BigNumber | undefined = bnZero;
  private realizedLpFeePctOverride = false;
  private destinationTokenForChainOverride: Record<number, string> = {};
  // Allow tester to set the numberOfDeposits() returned by SpokePool at a block height.
  public depositIdAtBlock: number[] = [];
  public numberOfDeposits = 0;
  public blocks: Record<number, Block> = {};

  constructor(logger: winston.Logger, spokePool: Contract, chainId: number, deploymentBlock: number) {
    super(logger, spokePool, null, chainId, deploymentBlock);
    this.latestBlockSearched = deploymentBlock;
    this.eventManager = getEventManager(chainId, this.eventSignatures, deploymentBlock);
  }

  setDefaultRealizedLpFeePct(fee: BigNumber | undefined): void {
    this.realizedLpFeePct = fee;
    this.realizedLpFeePctOverride = true;
  }

  clearDefaultRealizedLpFeePct(): void {
    this.realizedLpFeePctOverride = false;
  }

  async computeRealizedLpFeePct(depositEvent: FundsDepositedEvent) {
    const { realizedLpFeePct, realizedLpFeePctOverride } = this;
    const { blockNumber: quoteBlock } = depositEvent;
    return realizedLpFeePctOverride
      ? { realizedLpFeePct, quoteBlock }
      : await super.computeRealizedLpFeePct(depositEvent);
  }

  async batchComputeRealizedLpFeePct(depositEvents: FundsDepositedEvent[]) {
    const { realizedLpFeePct, realizedLpFeePctOverride } = this;
    return realizedLpFeePctOverride
      ? depositEvents.map(({ blockNumber: quoteBlock }) => {
          return { realizedLpFeePct, quoteBlock };
        })
      : await super.batchComputeRealizedLpFeePct(depositEvents);
  }

  setDestinationTokenForChain(chainId: number, token: string): void {
    this.destinationTokenForChainOverride[chainId] = token;
  }

  getDestinationTokenForDeposit(deposit: DepositWithBlock): string {
    return this.destinationTokenForChainOverride[deposit.originChainId] ?? super.getDestinationTokenForDeposit(deposit);
  }

  setLatestBlockNumber(blockNumber: number): void {
    this.latestBlockSearched = blockNumber;
  }

  setDepositIds(_depositIds: number[]): void {
    this.depositIdAtBlock = [];
    if (_depositIds.length === 0) {
      return;
    }
    let lastDepositId = _depositIds[0];
    for (let i = 0; i < _depositIds.length; i++) {
      if (_depositIds[i] < lastDepositId) {
        throw new Error("deposit ID must be equal to or greater than previous");
      }
      this.depositIdAtBlock[i] = _depositIds[i];
      lastDepositId = _depositIds[i];
    }
  }
  _getDepositIdAtBlock(blockTag: number): Promise<number> {
    return Promise.resolve(this.depositIdAtBlock[blockTag]);
  }

  async _update(eventsToQuery: string[]): Promise<SpokePoolUpdate> {
    // Generate new "on chain" responses.
    const latestBlockSearched = this.eventManager.blockNumber;
    const currentTime = getCurrentTime();

    const blocks: { [blockNumber: number]: Block } = {};

    // Ensure an array for every requested event exists, in the requested order.
    // All requested event types must be populated in the array (even if empty).
    const events: Event[][] = eventsToQuery.map(() => []);
    await forEachAsync(this.eventManager.getEvents().flat(), async (event) => {
      const idx = eventsToQuery.indexOf(event.event as string);
      if (idx !== -1) {
        events[idx].push(event);
        blocks[event.blockNumber] = await event.getBlock();
      }
    });
    this.blocks = blocks;

    // Update latestDepositIdQueried.
    const idx = eventsToQuery.indexOf("FundsDeposited");
    const latestDepositId = (events[idx] ?? []).reduce(
      (depositId, event) => Math.max(depositId, event.args?.["depositId"] ?? 0),
      this.latestDepositIdQueried
    );

    return {
      success: true,
      firstDepositId: 0,
      latestDepositId,
      currentTime,
      events,
      blocks,
      searchEndBlock: this.eventSearchConfig.toBlock || latestBlockSearched,
    };
  }

  // Event signatures. Not strictly required, but they make generated events more recognisable.
  public readonly eventSignatures: Record<string, string> = {
    EnabledDepositRoute: "address,uint256,bool",
    FilledRelay: "uint256,uint256,uint256,int64,uint32,uint32,address,address,address,bytes",
    FundsDeposited: "uint256,uint256,uint256,int64,uint32,uint32,address,address,address,bytes",
  };

  generateDeposit(deposit: DepositWithBlock): Event {
    const event = "FundsDeposited";

    const { blockNumber, transactionIndex } = deposit;
    let { depositId, depositor, destinationChainId } = deposit;
    depositId ??= this.numberOfDeposits;
    assert(depositId >= this.numberOfDeposits, `${depositId} < ${this.numberOfDeposits}`);
    this.numberOfDeposits = depositId + 1;

    destinationChainId ??= random(1, 42161, false);
    depositor ??= randomAddress();

    const message = deposit["message"] ?? `${event} event at block ${blockNumber}, index ${transactionIndex}.`;
    const topics = [destinationChainId, depositId, depositor];
    const args = {
      amount: deposit.amount ?? toBNWei(random(1, 1000, false)),
      originChainId: deposit.originChainId ?? this.chainId,
      destinationChainId,
      relayerFeePct: deposit.relayerFeePct ?? toBNWei(0.0001),
      depositId,
      quoteTimestamp: deposit.quoteTimestamp ?? getCurrentTime(),
      originToken: deposit.originToken ?? randomAddress(),
      recipient: deposit.recipient ?? depositor,
      depositor,
      message,
    };

    return this.eventManager.generateEvent({
      event,
      address: this.spokePool.address,
      topics: topics.map((topic) => topic.toString()),
      args,
      blockNumber,
      transactionIndex,
    });
  }

  generateFill(fill: FillWithBlock): Event {
    const event = "FilledRelay";

    const { blockNumber, transactionIndex } = fill;
    let { depositor, originChainId, depositId } = fill;
    originChainId ??= random(1, 42161, false);
    depositId ??= random(1, 100_000, false);
    depositor ??= randomAddress();

    const topics = [originChainId, depositId, depositor];
    const recipient = fill.recipient ?? randomAddress();
    const amount = fill.amount ?? toBNWei(random(1, 1000, false));
    const relayerFeePct = fill.relayerFeePct ?? toBNWei(0.0001);
    const message = fill["message"] ?? `${event} event at block ${blockNumber}, index ${transactionIndex}.`;

    const args = {
      amount,
      totalFilledAmount: fill.totalFilledAmount ?? amount,
      fillAmount: fill.fillAmount ?? amount,
      repaymentChainId: fill.repaymentChainId ?? this.chainId,
      originChainId,
      destinationChainId: fill.destinationChainId,
      realizedLpFeePct: fill.realizedLpFeePct ?? toBNWei(random(0.00001, 0.0001).toPrecision(6)),
      relayerFeePct,
      depositId,
      destinationToken: fill.destinationToken ?? ZERO_ADDRESS, // resolved via HubPoolClient.
      relayer: fill.relayer ?? randomAddress(),
      depositor,
      recipient,
      message,
      updatableRelayData: {
        recipient: fill.updatableRelayData?.recipient ?? recipient,
        message: fill.updatableRelayData?.message ?? message,
        relayerFeePct: fill.updatableRelayData?.relayerFeePct ?? relayerFeePct,
        isSlowRelay: fill.updatableRelayData?.isSlowRelay ?? false,
        payoutAdjustmentPct: fill.updatableRelayData?.payoutAdjustmentPct ?? bnZero,
      },
    };

    return this.eventManager.generateEvent({
      event,
      address: this.spokePool.address,
      topics: topics.map((topic) => topic.toString()),
      args,
      blockNumber,
      transactionIndex,
    });
  }

  generateDepositRoute(
    originToken: string,
    destinationChainId: number,
    enabled: boolean,
    overrides: EventOverrides = {}
  ): Event {
    const event = "EnabledDepositRoute";

    const topics = [originToken, destinationChainId];
    const args = { originToken, destinationChainId, enabled };

    return this.eventManager.generateEvent({
      event,
      address: this.spokePool.address,
      topics: topics.map((topic) => topic.toString()),
      args,
      blockNumber: overrides.blockNumber,
    });
  }
}
