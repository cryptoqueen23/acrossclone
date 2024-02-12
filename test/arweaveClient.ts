import { CHAIN_IDs } from "@across-protocol/constants-v2";
import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import axios from "axios";
import { expect } from "chai";
import { BigNumber, ethers } from "ethers";
import { array, object, string } from "superstruct";
import winston from "winston";
import { ArweaveClient } from "../src/caching";
import { FillStatus, FillsRefundedLeaf, FillsRefundedLeafSS } from "../src/interfaces";
import { parseWinston, toBN } from "../src/utils";

/**
 * Generates a random FillsRefundedLeaf for testing purposes.
 * This will use PRNG to generate a random leaf. All statuses are random.
 */
function generateRandomFillsRefundedLeaf(): FillsRefundedLeaf {
  const randHex = (len: number) => ethers.utils.hexlify(ethers.utils.randomBytes(len));
  const randChainId = () => Object.values(CHAIN_IDs)[Math.floor(Math.random() * Object.values(CHAIN_IDs).length)];
  const randBN = () =>
    BigNumber.from(Math.floor(Math.random() * 100)).mul(BigNumber.from(10).pow(Math.floor(Math.random() * 10)));
  return {
    status: [FillStatus.Filled, FillStatus.RequestedSlowFill, FillStatus.Unfilled][Math.floor(Math.random() * 3)],
    relayDataHash: randHex(64),
    lpFeePct: randBN(),
    relayer: randHex(32),
    repaymentChainId: randChainId(),
    paymentAmount: randBN(),
    paymentRecipient: randHex(32),
    paymentMessage: randHex(64),
  };
}

const INITIAL_FUNDING_AMNT = "5000000000";
const LOCAL_ARWEAVE_NODE = {
  protocol: "http",
  host: "localhost",
  port: 1984,
};
const LOCAL_ARWEAVE_URL = `${LOCAL_ARWEAVE_NODE.protocol}://${LOCAL_ARWEAVE_NODE.host}:${LOCAL_ARWEAVE_NODE.port}`;

const mineBlock = () => axios.get(`${LOCAL_ARWEAVE_URL}/mine`);

describe("ArweaveClient", () => {
  let jwk: JWKInterface;
  let client: ArweaveClient;
  // Before running any of the tests, we need to fund the address with some AR
  // so that we can post to our testnet node
  before(async () => {
    // Generate a new JWK for our tests
    jwk = await Arweave.init({}).wallets.generate();
    // Resolve the address of the JWK
    const address = await Arweave.init({}).wallets.jwkToAddress(jwk);
    // Call into the local arweave node to fund the address
    await axios.get(`${LOCAL_ARWEAVE_URL}/mint/${address}/${INITIAL_FUNDING_AMNT}`);
    // Wait for the transaction to be mined
    await mineBlock();
  });

  beforeEach(() => {
    // Create a new Arweave client
    client = new ArweaveClient(
      jwk,
      // Define default winston logger
      winston.createLogger({
        level: "info",
        format: winston.format.json(),
        defaultMeta: { service: "arweave-client" },
        transports: [new winston.transports.Console()],
      }),
      LOCAL_ARWEAVE_NODE.host,
      LOCAL_ARWEAVE_NODE.protocol,
      LOCAL_ARWEAVE_NODE.port
    );
  });

  it(`should have ${INITIAL_FUNDING_AMNT} initial AR in the address`, async () => {
    const balance = (await client.getBalance()).toString();
    expect(balance.toString()).to.equal(parseWinston(INITIAL_FUNDING_AMNT).toString());
  });

  it("should be able to set a basic record and view it on the network", async () => {
    const value = { test: "value" };
    const txID = await client.set(value);
    console.log(txID);
    expect(txID).to.not.be.undefined;

    // Wait for the transaction to be mined
    await mineBlock();
    await mineBlock();

    const retrievedValue = await client.get(txID!, object());
    expect(retrievedValue).to.deep.equal(value);
  });

  it("should successfully set a record with a BigNumber", async () => {
    const value = { test: "value", bigNumber: toBN("1000000000000000000") };
    const txID = await client.set(value);
    expect(txID).to.not.be.undefined;

    // Wait for the transaction to be mined
    await mineBlock();
    await mineBlock();

    const retrievedValue = await client.get(txID!, object());

    const expectedValue = { test: "value", bigNumber: "1000000000000000000" };
    expect(retrievedValue).to.deep.equal(expectedValue);
  });

  it("should fail to get a non-existent record", async () => {
    const retrievedValue = await client.get("non-existent", object());
    expect(retrievedValue).to.be.null;
  });

  it("should validate the record with a struct validator", async () => {
    const value = { test: "value" };
    const txID = await client.set(value);
    expect(txID).to.not.be.undefined;

    // Wait for the transaction to be mined
    await mineBlock();
    await mineBlock();

    const validatorStruct = object({ test: string() });

    const retrievedValue = await client.get(txID!, validatorStruct);
    expect(retrievedValue).to.deep.equal(value);
  });

  it("should fail validation of the record with a struct validator that doesn't match the returned type", async () => {
    const value = { test: "value" };
    const txID = await client.set(value);
    expect(txID).to.not.be.undefined;

    // Wait for the transaction to be mined
    await mineBlock();
    await mineBlock();

    const validatorStruct = object({ invalid: string() });

    const retrievedValue = await client.get(txID!, validatorStruct);
    expect(retrievedValue).to.eq(null);
  });

  it.only("should be able to set and retrieve a complex record", async () => {
    const length = 25;
    // Generate {length} random FillRefundedLeafs
    const fills: FillsRefundedLeaf[] = Array.from({ length }, () => generateRandomFillsRefundedLeaf());

    const txID = await client.set({ fills });
    expect(txID).to.not.be.undefined;

    // Wait for the transaction to be mined
    await mineBlock();
    await mineBlock();
    await mineBlock();

    const retrievedFills = await client.get(txID!, object({ fills: array(FillsRefundedLeafSS) }));

    expect(retrievedFills).to.not.be.null;
    expect(retrievedFills?.fills).to.not.be.null;
    expect(retrievedFills?.fills).to.have.lengthOf(length);
    expect(retrievedFills).to.deep.equal({ fills });
  });
});
