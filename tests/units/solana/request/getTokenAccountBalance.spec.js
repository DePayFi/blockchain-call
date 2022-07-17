import { mock, resetMocks } from '@depay/web3-mock'
import { request, provider, resetCache } from 'src/'
import { struct, publicKey, u64, u32, u8, PublicKey, Buffer } from '@depay/solana-web3.js'
import { supported } from 'src/blockchains'

describe('request getTokenAccountBalance', () => {

  supported.solana.forEach((blockchain)=>{

    describe(blockchain, ()=> {

      const accounts = ['2UgCJaHU5y8NC4uWQcZYeV9a5RyYLF7iKYCybCsdFFD1']
      beforeEach(resetMocks)
      beforeEach(resetCache)
      beforeEach(()=>mock({ blockchain, accounts: { return: accounts } }))

      it('requests getTokenAccountBalance with given filters', async ()=> {

        let tokenAccount = '2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9'
        
        let returnedBalance = {
          amount: "10000617",
          decimals: 6,
          uiAmount: 10.000617,
          uiAmountString: "10.000617"
        }

        let requestMock = mock({
          provider: provider(blockchain),
          blockchain,
          request: {
            method: 'getTokenAccountBalance',
            to: tokenAccount,
            return: returnedBalance
          }
        })

        let balance = await request(`solana://${tokenAccount}/getTokenAccountBalance`)
        
        expect(balance.value).toEqual(returnedBalance)
      })
    })
  })
})
