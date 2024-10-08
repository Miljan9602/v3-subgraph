import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'

import { exponentToBigDecimal, safeDiv } from '../utils/index'
import { Bundle, Pool, Token } from './../types/schema'
import { ONE_BD, ZERO_BD, ZERO_BI } from './constants'

export const WETH_ADDRESS = '0x027d2e627209f1ceba52adc8a5afe9318459b44b'

export const USDC_WETH_03_POOL = '0xe33633a1364d4fc7686a22fa6ac56dcd7f72f420'
export const STABLECOIN_IS_TOKEN0 = false

// token where amounts should contribute to tracked volume and liquidity
// usually tokens that many tokens are paired with s
export const WHITELIST_TOKENS: string[] = [
  WETH_ADDRESS, // WETH
  // '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x027d2e627209f1ceba52adc8a5afe9318459b44b', // wsei
  '0xf4855a5aaf42bf27163d8981b16bb0ef80620550', // USDC
  '0x8b595a7b0cd41f3c0dac80114f6a351274be60e6', // USDT
  // '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  // '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  // '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643', // cDAI
  // '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
  // '0x86fadb80d8d2cff3c3680819e4da99c10232ba0f', // EBASE
  // '0x57ab1ec28d129707052df4df418d58a2d46d5f51', // sUSD
  // '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
  // '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
  // '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
  // '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', // SNX
  // '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', // YFI
  // '0x111111111117dc0aa78b770fa6a738034120c302', // 1INCH
  // '0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8', // yCurv
  // '0x956f47f50a910163d8bf957cf5846d573e7f87ca', // FEI
  // '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', // MATIC
  // '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
  // '0xfe2e637202056d30016725477c5da089ab0a043a', // sETH2
]

export const STABLE_COINS: string[] = [
  '0xf4855a5aaf42bf27163d8981b16bb0ef80620550', // USDC
  '0x8b595a7b0cd41f3c0dac80114f6a351274be60e6', // USDT
]

export const MINIMUM_ETH_LOCKED = BigDecimal.fromString('1')

const Q192 = BigInt.fromI32(2).pow(192 as u8)
export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt, token0: Token, token1: Token): BigDecimal[] {
  const num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal()
  const denom = BigDecimal.fromString(Q192.toString())
  const price1 = num.div(denom).times(exponentToBigDecimal(token0.decimals)).div(exponentToBigDecimal(token1.decimals))

  const price0 = safeDiv(BigDecimal.fromString('1'), price1)
  return [price0, price1]
}

export function getEthPriceInUSD(
  stablecoinWrappedNativePoolAddress: string = USDC_WETH_03_POOL,
  stablecoinIsToken0: boolean = STABLECOIN_IS_TOKEN0, // true is stablecoin is token0, false if stablecoin is token1
): BigDecimal {
  const stablecoinWrappedNativePool = Pool.load(stablecoinWrappedNativePoolAddress)
  if (stablecoinWrappedNativePool !== null) {
    return stablecoinIsToken0 ? stablecoinWrappedNativePool.token0Price : stablecoinWrappedNativePool.token1Price
  } else {
    return ZERO_BD
  }
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(
  token: Token,
  wrappedNativeAddress: string = WETH_ADDRESS,
  stablecoinAddresses: string[] = STABLE_COINS,
  minimumEthLocked: BigDecimal = MINIMUM_ETH_LOCKED,
): BigDecimal {
  if (token.id == wrappedNativeAddress) {
    return ONE_BD
  }
  const whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD
  let priceSoFar = ZERO_BD
  const bundle = Bundle.load('1')!

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (stablecoinAddresses.includes(token.id)) {
    priceSoFar = safeDiv(ONE_BD, bundle.ethPriceUSD)
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      const poolAddress = whiteList[i]
      const pool = Pool.load(poolAddress)

      if (pool) {
        if (pool.liquidity.gt(ZERO_BI)) {
          if (pool.token0 == token.id) {
            // whitelist token is token1
            const token1 = Token.load(pool.token1)
            // get the derived ETH in pool
            if (token1) {
              const ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH)
              if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumEthLocked)) {
                largestLiquidityETH = ethLocked
                // token1 per our token * Eth per token1
                priceSoFar = pool.token1Price.times(token1.derivedETH as BigDecimal)
              }
            }
          }
          if (pool.token1 == token.id) {
            const token0 = Token.load(pool.token0)
            // get the derived ETH in pool
            if (token0) {
              const ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH)
              if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumEthLocked)) {
                largestLiquidityETH = ethLocked
                // token0 per our token * ETH per token0
                priceSoFar = pool.token0Price.times(token0.derivedETH as BigDecimal)
              }
            }
          }
        }
      }
    }
  }
  return priceSoFar // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): BigDecimal {
  const bundle = Bundle.load('1')!
  const price0USD = token0.derivedETH.times(bundle.ethPriceUSD)
  const price1USD = token1.derivedETH.times(bundle.ethPriceUSD)

  // For us, everything is tracked.
  return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))

  // // both are whitelist tokens, return sum of both amounts
  // if (whitelistTokens.includes(token0.id) && whitelistTokens.includes(token1.id)) {
  //   return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))
  // }
  //
  // // take double value of the whitelisted token amount
  // if (whitelistTokens.includes(token0.id) && !whitelistTokens.includes(token1.id)) {
  //   return tokenAmount0.times(price0USD).times(BigDecimal.fromString('2'))
  // }
  //
  // // take double value of the whitelisted token amount
  // if (!whitelistTokens.includes(token0.id) && whitelistTokens.includes(token1.id)) {
  //   return tokenAmount1.times(price1USD).times(BigDecimal.fromString('2'))
  // }

  // neither token is on white list, tracked amount is 0
  // return ZERO_BD
}
