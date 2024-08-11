import { createContext, useContext, useMemo, useEffect, useState } from "react";
import { BN } from "@project-serum/anchor";
import { SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

import {
  getLotteryAddress,
  getMasterAddress,
  getProgram,
  getTicketAddress,
  getTotalPrize,
} from "../utils/program";
import { confirmTx, mockWallet } from "../utils/helper";
import toast from "react-hot-toast";
import { TICKET_SEED } from "../utils/constants";

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [masterAddress, setMasterAddress] = useState();
  const [initialized, setInitialized] = useState(false);
  const [lotteryId, setLotteryId] = useState();
  const [lotteryPot, setLotteryPot] = useState();
  const [lottery, setLottery] = useState();
  const [lotteryAddress, setLotteryAddress] = useState();
  const [userWinningId, setUserWinningId] = useState(false);
  const [lotteryHistory, setLotteryHistory] = useState([]);

  // Get provider
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const program = useMemo(() => {
    if (connection) {
      return getProgram(connection, wallet ?? mockWallet());
    }
  }, [connection, wallet]);

  useEffect(() => {
    updateState();
  }, [program]); // Consider adding 'updateState' to the dependency array

  useEffect(() =>{
    if(!lottery) return
    getPot();
    getHistory();
  },[lottery]);

  const updateState = async () => {
    if (!program) return;
    try {
      if (!masterAddress) {
        // get master address
        const fetchedMasterAddress = await getMasterAddress();
        // store the master address
        setMasterAddress(fetchedMasterAddress);
      }

      const master = await program.account.master.fetch(
        masterAddress ?? (await getMasterAddress())
      );
      setInitialized(true);
      setLotteryId(master.lastId) 
      const lotteryAddress = await getLotteryAddress(master.lastId);
      setLotteryAddress(lotteryAddress)
      const lottery = await program.account.lottery.fetch(lotteryAddress);
      setLottery(lottery)

      // Get user's ticket for the current lottery
      if (!wallet?. publicKey) return;
      const userTickets = await program.account.ticket.all()
      console.log(userTickets);

      //Check whether any of the user tickets win
      const userWin = userTickets.some(
        (t)=> t.account.id === lottery.winnerId
      );

      if (userWin){
        console.log("There is a user win")
        setUserWinningId(lottery.winnerId)
      }else{
        setUserWinningId(null)
      }

    } catch (err) {
      console.log(err.message);
    }
  };

const getPot = async() =>{
  const pot = getTotalPrize(lottery);
  setLotteryPot(pot)
}

const getHistory = async() =>{
  if (!lotteryId) return;

  const history = [];

  for (const i in new Array(lotteryId).fill(null)){
    const id = lotteryId - parseInt(i);
    if(!id) break

    const lotteryAddress = await getLotteryAddress(id)
    const lottery = await program.account.lottery.fetch(lotteryAddress);
    const winnerId = lottery.winnerId;
    if(!winnerId) continue;
    
    const ticketAddress = await getTicketAddress(lotteryAddress, winnerId);
    const ticket = await program.account.ticket.fetch(ticketAddress);

    history.push({
      lotteryId : id ,
      winnerId,
      winnerAddress : ticket.authority,
      prize: getTotalPrize(lottery),
    })

  }

  setLotteryHistory(history)
}

  // Call solana program instruction
  const initMaster = async () => {
    try {
      const txHash = await program.methods
        .initMaster()
        .accounts({
          master: masterAddress,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await confirmTx(txHash, connection);

      updateState();
      toast.success("Initialized Master!")
    } catch (err) {
      console.log(err.message);
      toast.error(err.message);
    }
  }

  const createLottery = async () => {
    try {
      const LotteryAddress = await getLotteryAddress(lotteryId + 1); // PublicKey
      const txHash = await program.methods
        .createLottery(new BN(5).mul(new BN(LAMPORTS_PER_SOL)))
        .accounts({
          lottery: LotteryAddress,
          master: masterAddress,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await confirmTx(txHash, connection);

      updateState();
      toast.success("Lottery Created!")
    } catch (err) {
      console.log(err.message);
      toast.error(err.message);
    }
  }

  const buyTicket = async() =>{
    try{
      const txHash = await program.methods
      .buyTicket(lotteryId)
      .accounts(
        {lottery: lotteryAddress,
        ticket : await getTicketAddress(
          lotteryAddress,
          lottery.lastTicketId + 1
        ),
        buyer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
      await confirmTx(txHash, connection)
      updateState();
      toast.success("Bought a Ticket!")

    }catch(err){
      console.log(err.message);
      toast.error(err.message)
    }
  }

  const pickWinner = async () =>{
    try{
      const txHast = await program.methods
      .pickWinner(lotteryId)
      .accounts({
        lottery: lotteryAddress,
        authority: wallet.publicKey,
      }).rpc();
      await confirmTx(txHast,connection);
      
      updateState();
      toast.success("Picked a Winner!")
    }catch(err){
      toast.error(err.message);
    }
  }

  const claimPrize = async() =>{
    try{
      const txHash = await program.methods
      .claimPrize(lotteryId, userWinningId)
      .accounts({
        lottery: lotteryAddress,
        ticket: await getTicketAddress(lotteryAddress, userWinningId),
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

      await confirmTx(txHash, connection);
      updateState()
      toast.success("Claimed the Prize!!")

    }catch(err){
      toast.error(err.message);
    }
  }

  return (
    <AppContext.Provider
      value={{
        // Put functions/variables you want to bring out of context to App in here
        connected: wallet?.publicKey ? true : false,
        isMasterInitialized: initialized,
        lotteryId,
        lotteryPot,
        isLotteryAuthority: wallet && lottery && wallet.publicKey.equals(lottery.authority),
        isFinished: lottery && lottery.winnerId,
        canClaim: lottery && !lottery.claimed && userWinningId,
        lotteryHistory,
        initMaster,
        createLottery,
        buyTicket,
        pickWinner,
        claimPrize
        
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  return useContext(AppContext);
};