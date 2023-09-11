import { SpokePool } from "../typechain";

/**
 * Find the block range that contains the deposit ID. This is a binary search that searches for the block range
 * that contains the deposit ID.
 * @param targetDepositId The target deposit ID to search for.
 * @param initLow The initial lower bound of the block range to search.
 * @param initHigh The initial upper bound of the block range to search.
 * @param maxSearches The maximum number of searches to perform. This is used to prevent infinite loops.
 * @returns The block range that contains the deposit ID.
 * @note  // We want to find the block range that satisfies these conditions:
 *        // - the low block has deposit count <= targetDepositId
 *        // - the high block has a deposit count > targetDepositId.
 *        // This way the caller can search for a FundsDeposited event between [low, high] that will always
 *        // contain the event emitted when deposit ID was incremented to targetDepositId + 1. This is the same transaction
 *        // where the deposit with deposit ID = targetDepositId was created.
 */
export async function getBlockRangeForDepositId(
  targetDepositId: number,
  initLow: number,
  initHigh: number,
  maxSearches: number,
  spokePool: SpokePool
): Promise<{
  low: number;
  high: number;
}> {
  // Define a mapping of block numbers to deposit IDs. This is used to cache the deposit ID at a block number
  // so we don't need to make an eth_call request to get the deposit ID at a block number more than once.
  const queriedIds: Record<number, number> = {};

  // Define a llambda function to get the deposit ID at a block number. This function will first check the
  // queriedIds cache to see if the deposit ID at the block number has already been queried. If not, it will
  // make an eth_call request to get the deposit ID at the block number. It will then cache the deposit ID
  // in the queriedIds cache.
  const getDepositIdAtBlock = async (blockNumber: number): Promise<number> => {
    if (queriedIds[blockNumber] === undefined) {
      queriedIds[blockNumber] = await spokePool.numberOfDeposits({ blockTag: blockNumber });
    }
    return queriedIds[blockNumber];
  };

  // Sanity check to ensure that init Low is greater than or equal to zero.
  if (initLow < 0) {
    throw new Error("Binary search failed because low must be >= 0");
  }

  // Sanity check to ensure that initHigh is greater than or equal to initLow.
  if (initLow > initHigh) {
    throw new Error("Binary search failed because low > high");
  }

  // Sanity check to ensure that maxSearches is greater than zero.
  if (maxSearches <= 0) {
    throw new Error("maxSearches must be > 0");
  }

  // If the deposit ID at the initial high block is less than the target deposit ID, then we know that
  // the target deposit ID must be greater than the initial high block, so we can throw an error.
  if ((await getDepositIdAtBlock(initHigh)) < targetDepositId) {
    throw new Error("Failed to find deposit ID");
  }

  // If the deposit ID at the initial low block is greater than the target deposit ID, then we know that
  // the target deposit ID must be less than the initial low block, so we can throw an error.
  if ((await getDepositIdAtBlock(initLow)) > targetDepositId) {
    throw new Error("Failed to find deposit ID");
  }

  // Define the low and high block numbers for the binary search.
  let low = initLow;
  let high = initHigh;

  // Define the number of searches performed so far.
  let searches = 0;

  do {
    // Resolve the mid point of the block range.
    const mid = Math.floor((low + high) / 2);

    // Get the deposit ID at the mid point.
    const midDepositId = await getDepositIdAtBlock(mid);

    // Get the deposit ID of the block previous to the mid point.
    // We can use this to get the range that the current midpoint block
    // has between the previous block and the current block.
    // NOTE: If the midpoint is block 0, then we can assume that the deposit ID
    //       of the previous block is 0.
    const prevDepositId = mid === 0 ? 0 : await getDepositIdAtBlock(mid - 1);

    // Let's define the range of the current midpoint block.
    // The range is [prevDepositId, midDepositId - 1].
    const lowRange = prevDepositId;
    const highRange = midDepositId - 1;

    // If our target deposit ID is less than the smallest range of our
    // midpoint deposit ID range, then we know that the target deposit ID
    // must be in the lower half of the block range.
    if (targetDepositId < lowRange) {
      high = mid - 1;
    }
    // If our target deposit ID is greater than the largest range of our
    // midpoint deposit ID range, then we know that the target deposit ID
    // must be in the upper half of the block range.
    else if (targetDepositId > highRange) {
      low = mid + 1;
    }
    // Otherwise, we've found the block range that contains the deposit ID.
    else {
      low = mid;
      high = mid;
    }
  } while (++searches < maxSearches && low < high);

  // We've either found the block range or we've exceeded the maximum number of searches.
  // In either case, the block range is [low, high] so we can return it.
  return { low, high };
}

/**
 * Finds the deposit id at a specific block number.
 * @param blockTag The block number to search for the deposit ID at.
 * @returns The deposit ID.
 */
export async function getDepositIdAtBlock(contract: SpokePool, blockTag: number): Promise<number> {
  return await contract.numberOfDeposits({ blockTag });
}
