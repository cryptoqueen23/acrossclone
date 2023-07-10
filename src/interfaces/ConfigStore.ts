import { BigNumber } from "ethers";
import { SortableEvent } from "./Common";
import { across } from "@uma/sdk";

export interface ParsedTokenConfig {
  transferThreshold: string;
  rateModel: across.rateModel.RateModelDictionary;
  routeRateModel?: {
    [path: string]: across.rateModel.RateModelDictionary;
  };
  uba?: UBAOnChainConfigType;
  spokeTargetBalances?: {
    [chainId: number]: {
      target: string;
      threshold: string;
    };
  };
}

export interface L1TokenTransferThreshold extends SortableEvent {
  transferThreshold: BigNumber;
  l1Token: string;
}

export interface SpokePoolTargetBalance {
  target: BigNumber;
  threshold: BigNumber;
}

export interface SpokeTargetBalanceUpdate extends SortableEvent {
  spokeTargetBalances?: {
    [chainId: number]: SpokePoolTargetBalance;
  };
  l1Token: string;
}

export interface RouteRateModelUpdate extends SortableEvent {
  routeRateModel: {
    [path: string]: string;
  };
  l1Token: string;
}

export interface TokenConfig extends SortableEvent {
  key: string;
  value: string;
}

export interface GlobalConfigUpdate extends SortableEvent {
  value: number;
}

export interface ConfigStoreVersionUpdate extends GlobalConfigUpdate {
  timestamp: number;
}

export interface DisabledChainsUpdate extends SortableEvent {
  chainIds: number[];
}

/**
 * A generic type of a dictionary that has string keys and values of type T. This
 * record is enforced to have a default entry within the "default" key.
 * @type Value The type of the values in the dictionary.
 */
type RecordWithDefaultEntry<Value> = Record<string, Value>;

/**
 * A generic type for a dictionary that has two keys representing parallel arrays
 * of cutoff points and values. The cutoff points are sorted in ascending order.
 * @type Value The type of the values in the array.
 */
type CutoffAndValueArray<Value> = {
  cutoff: Value[];
  value: Value[];
};

/**
 * A type for the UBA config object stored both on and off chain.
 * @type T The type of the values in the config.
 * @note This is a dictionary of parameters that defines a fee curve for the token.
 *       These parameters can be further subindexed by a route (e.g. using the key "1-10" or "42161-1")
 *       to create a specific fee curve for a token per route. The subkeys are as followed:
 *         - alpha: The alpha parameter of the fee curve.
 *         - gamma: The gamma parameter of the fee curve.
 *         - omega: The omega parameter of the fee curve.
 *         - rebalance: The rebalance parameters of the fee curve.
 */
type UBAAgnosticConfigType<T> = {
  /**
   * This is a scalar value that is a constant percentage of each transfer that is allocated for LPs.
   * This value can be determined by token and route-by-route.
   */
  alpha: RecordWithDefaultEntry<T>;
  /**
   * This is a piecewise linear function (defined by a vector of cut-off points and the values at
   * those points) that determine additional LP fees as a function of utilization. This piecewise
   * linear function can be determined by token and chain-by-chain.
   */
  gamma: RecordWithDefaultEntry<CutoffAndValueArray<T>>;
  /**
   * This is a piecewise linear function (defined by a vector of cut-off points and the values at
   * those points) that determine the balancing fees (rewards) that are imposed on (paid to) a user
   * who makes a transfer involving a particular chain. There is a single piecewise linear function for
   * each token/chain combination. A transfer will incur a balancing fee on both the origin and destination
   * chains.
   */
  omega: RecordWithDefaultEntry<CutoffAndValueArray<T>>;
  /**
   * This is a set of parameters that determine when a rebalance is triggered. A rebalance is triggered
   * when the utilization of a pool is outside of the range defined by the lower and upper thresholds.
   */
  rebalance: RecordWithDefaultEntry<{
    /**
     * For tokens/chains that have a supported bridge, these are the lower and upper threshold that trigger
     * the reallocation of funds. i.e. If the running balance on a chain moves below (above) threshold_lower
     * (threshold_upper) then the bridge moves funds from Ethereum to the chain (from the chain to Ethereum).
     */
    threshold_lower: T;
    /**
     * For tokens/chains that have a supported bridge, these are the lower and upper threshold that trigger
     * the reallocation of funds. i.e. If the running balance on a chain moves below (above) threshold_lower
     * (threshold_upper) then the bridge moves funds from Ethereum to the chain (from the chain to Ethereum).
     */
    threshold_upper: T;
    /**
     * For tokens/chains that have a supported bridge, these are the values that are targeted whenever funds
     * are reallocated.
     */
    target_lower: T;
    /**
     * For tokens/chains that have a supported bridge, these are the values that are targeted whenever funds
     * are reallocated.
     */
    target_upper: T;
  }>;
};

/**
 * A type for the UBA config object stored on chain.
 */
export type UBAOnChainConfigType = UBAAgnosticConfigType<string>;

/**
 * A type for the UBA config object after it has been parsed.
 */
export type UBAParsedConfigType = UBAAgnosticConfigType<BigNumber>;

/**
 * A type for UBAConfig Update events.
 */
export type UBAConfigUpdates = SortableEvent & { config: UBAParsedConfigType };
