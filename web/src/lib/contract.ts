import { parseAbi } from "viem";

export const wasteRewardAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to,uint256 value) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalWeightInGrams() view returns (uint256)",
  "function getCitizenDepositIds(address citizen) view returns (uint256[])",
  "function deposits(uint256) view returns (uint256 depositId,address citizen,string wasteType,uint256 weightInGrams,uint256 timestamp)",
  "event DepositRecorded(uint256 indexed depositId,address indexed citizen,string wasteType,uint256 weightInGrams,uint256 reward)"
]);

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
const fallbackAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
const localAddress = process.env.NEXT_PUBLIC_LOCAL_CONTRACT_ADDRESS || (configuredChainId === 31337 ? fallbackAddress : undefined) || zeroAddress;
const baseSepoliaAddress = process.env.NEXT_PUBLIC_BASE_SEPOLIA_CONTRACT_ADDRESS || (configuredChainId === 84532 ? fallbackAddress : undefined) || zeroAddress;

export function contractAddressForChain(chainId?: number) {
  if (chainId === 31337) return localAddress as `0x${string}`;
  if (chainId === 84532) return baseSepoliaAddress as `0x${string}`;
  return zeroAddress as `0x${string}`;
}
