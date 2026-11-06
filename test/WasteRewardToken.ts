import { expect } from "chai";
import { ethers } from "hardhat";

describe("WasteRewardToken", function () {
  async function deploy() {
    const [owner, citizen, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("WasteRewardToken");
    const token = await Token.deploy();
    return { token, owner, citizen, other };
  }

  it("mints 10 RCT per kilogram, prorated by grams", async function () {
    const { token, citizen } = await deploy();
    await token.recordDeposit(citizen.address, "Plastic", 1_500);
    expect(await token.balanceOf(citizen.address)).to.equal(ethers.parseEther("15"));
    expect(await token.totalWeightInGrams()).to.equal(1_500);
  });

  it("stores deposit data and citizen history", async function () {
    const { token, citizen } = await deploy();
    await token.recordDeposit(citizen.address, "Glass", 750);
    const deposit = await token.deposits(1);
    expect(deposit.citizen).to.equal(citizen.address);
    expect(deposit.wasteType).to.equal("Glass");
    expect(deposit.weightInGrams).to.equal(750);
    expect(await token.getCitizenDepositIds(citizen.address)).to.deep.equal([1n]);
  });

  it("restricts deposit recording to owner", async function () {
    const { token, citizen, other } = await deploy();
    await expect(token.connect(other).recordDeposit(citizen.address, "Metal", 100)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("rejects invalid citizen, waste type, and weight", async function () {
    const { token, citizen } = await deploy();
    await expect(token.recordDeposit(ethers.ZeroAddress, "Plastic", 10)).to.be.revertedWith("Invalid citizen");
    await expect(token.recordDeposit(citizen.address, "", 10)).to.be.revertedWith("Invalid waste type");
    await expect(token.recordDeposit(citizen.address, "Plastic", 0)).to.be.revertedWith("Invalid weight");
  });
});
