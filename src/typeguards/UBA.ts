import { FillWithBlock, RefundRequestWithBlock, UbaFlow, UbaInflow, UbaOutflow } from "../interfaces";

export const isUbaInflow = (flow: UbaFlow): flow is UbaInflow => {
  return (flow as UbaInflow).quoteTimestamp !== undefined;
};

export const isUbaOutflow = (flow: UbaFlow): flow is UbaOutflow => {
  return !isUbaInflow(flow) && (outflowIsFill(flow) || outflowIsRefund(flow));
};

export const outflowIsFill = (outflow: UbaOutflow): outflow is FillWithBlock => {
  return (outflow as FillWithBlock).isSlowRelay !== undefined;
};

export const outflowIsRefund = (outflow: UbaOutflow): outflow is RefundRequestWithBlock => {
  return (outflow as RefundRequestWithBlock).fillBlock !== undefined;
};
