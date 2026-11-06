const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer configured for this network");
  console.log(`Deploying RecycleToken with ${deployer.address} on ${hre.network.name}...`);
  const Token = await hre.ethers.getContractFactory("WasteRewardToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`WasteRewardToken deployed to: ${address}`);
  console.log(`Owner/oracle address: ${deployer.address}`);
  console.log("Set NEXT_PUBLIC_CONTRACT_ADDRESS to the deployed address in the web app.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
