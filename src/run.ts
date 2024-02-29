/**
 * ZK Battleships Game Simulation on the MINA Blockchain.
 * 
 * This file serves to simulate a Battleships game conducted on the MINA blockchain.
 * To utilize the provided API, you need to provide valid game boards for both the host and the joiner,
 * along with a set of shots for the entire game.
 * 
 * For best results, ensure that the target arrays for both players (host and joiner) have the same length.
 * Additionally, set one player's target series to destroy all of the adversary's ships.
 * 
 * @note To run a simulation:
 * 1. Provide valid game boards and shot series.
 * 2. If you want to simulate the game and generate proofs, run `npm run simulate provable`.
 * 
 * @note To run the second game simulation, uncomment the code at the end of the file and execute `npm run simulate`.
 * 
 */

import { Battleships } from './Battleships.js';
import { BattleShipsClient } from './client.js';
import { printLog } from './displayUtils.js';
import {
  Mina,
  AccountUpdate,
  PrivateKey,
  PublicKey,
} from 'o1js';

const proofsEnabled = process.argv[2] ? true : false;

async function localDeploy(zkapp: Battleships, deployerKey: PrivateKey, zkappPrivateKey: PrivateKey) { 
  const deployerAccount = deployerKey.toPublicKey();
  const tx = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkapp.deploy();
  });
  
  await tx.prove();
  await tx.sign([deployerKey, zkappPrivateKey]).send();
}
  
async function initializeGame(zkapp: Battleships, deployerKey: PrivateKey) {
  const deployerAccount = deployerKey.toPublicKey();

  // deployer initializes zkapp
  const initTx = await Mina.transaction(deployerAccount, () => {
    zkapp.initGame();
  });

  await initTx.prove();
  await initTx.sign([deployerKey]).send();
}

async function runGame(gameBoard: typeof game1Boards, gameShots: typeof game1Shots) {
  console.log('Mina ZK Battleships: Game Simulation');

  let hostKey: PrivateKey,
  joinerKey: PrivateKey, 
  zkappAddress: PublicKey,
  zkappPrivateKey: PrivateKey,
  zkapp: Battleships,
  joiner: BattleShipsClient,
  host: BattleShipsClient;

  if (proofsEnabled) await Battleships.compile();

  // setup local blockchain
  const Local = Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(Local);

  // Local.testAccounts is an array of 10 test accounts that have been pre-filled with Mina
  hostKey = Local.testAccounts[0].privateKey;
  joinerKey = Local.testAccounts[1].privateKey;

  // zkapp account
  zkappPrivateKey = PrivateKey.random();
  zkappAddress = zkappPrivateKey.toPublicKey();
  zkapp = new Battleships(zkappAddress);

  // initialize client for each player
  host = BattleShipsClient.initialize(zkapp, hostKey, gameBoard.host);
  joiner = BattleShipsClient.initialize(zkapp, joinerKey, gameBoard.joiner);

  // deploy and initialize game
  await localDeploy(zkapp, hostKey, zkappPrivateKey);
  await initializeGame(zkapp, hostKey);

  console.time('Simulation Time: ');

  console.log('Host new game');
  await host.hostGame();
  host.displayGameSummary();

  console.log('Join the game');
  await joiner.joinGame();
  joiner.displayGameSummary();

  console.log('Host plays opening shot');
  await host.playFirstTurn(gameShots.host[0]);

  console.log('Alternate player attacks');
  for (let player1_nonce = 1; player1_nonce <= gameShots.host.length - 1; player1_nonce++) {
    printLog(`Player2 reporting result of Player1 shot #${player1_nonce - 1} (Turn ${player1_nonce * 2 - 1})`)
    await joiner.playTurn(gameShots.joiner[player1_nonce - 1]);
    
    printLog(`Player1 reporting result of Player2 shot #${player1_nonce - 1} (Turn ${player1_nonce * 2})`)
    await host.playTurn(gameShots.host[player1_nonce]);
  }  

  console.log("\nPlayer wins on sinking all of adversary's ships");
  await joiner.playTurn(gameShots.joiner[gameShots.host.length - 1]);

  /**
   * As the Battleships zkapp will revert any transactions after the game is over.   
   * This section might revert if the host wins(that's why we catch the error and do nothing). 
   * However, it's important to report Player2's hit result in the scenario that we simulate that he/she wins.
   */
  try {
    await host.playTurn([0, 0]);
  } catch (error) { /* do nothing */ }

  host.displayGameSummary();
  joiner.displayGameSummary();

  console.timeEnd('Simulation Time: ');
}

const game1Boards = {
  host: [
    [0, 4, 0],
    [9, 3, 1],
    [3, 5, 1],
    [2, 2, 0],
    [0, 9, 0],
   ],
  joiner: [
    [1, 0, 0],
    [1, 1, 0],
    [1, 2, 0],
    [1, 3, 0],
    [1, 4, 0],
  ],
}

const game1Shots = {
  host: [
    [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
    [1, 1], [2, 1], [3, 1], [4, 1],
    [1, 2], [2, 2], [3, 2],
    [1, 3], [2, 3], [3, 3],
    [1, 4], [2, 4]
  ],
  joiner: [
    [9, 9], [9, 8], [9, 7], [9, 6], [9, 5],
    [9, 4], [9, 3], [9, 2], [9, 1],
    [9, 0], [8, 9], [0, 8],
    [8, 7], [8, 6], [8, 8],
    [8, 4], [8, 5]
  ],
}

/**
 * The fastest game simulation: Player 1 destroys all of Player 2's ships in just 17 attacks.
 * 
 * @note Running the simulation with `proofsEnabled=true` may take around 12 minutes.
 */
await runGame(game1Boards, game1Shots);

/* 
const game2Boards = {
  host: [
    [4, 2, 1],
    [1, 1, 0],
    [8, 6, 1],
    [3, 9, 0],
    [6, 3, 1],
  ],
  joiner: [
    [1, 8, 0],
    [0, 3, 1],
    [3, 1, 1],
    [8, 5, 1],
    [8, 9, 0],
  ],
}
  
const game2Shots = {
  host: [
    [1, 0], [2, 2], [0, 5], [0, 6], [0, 7],
    [0, 3], [2, 9], [6, 4], [3, 1], [3, 2],
    [3, 0], [3, 3], [3, 4], [4, 6], [2, 4],
    [6, 6], [5, 7], [5, 8], [5, 9], [4, 8],
    [3, 8], [2, 8], [1, 8], [6, 7], [7, 3],
  ],
  joiner: [
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
    [5, 1], [4, 2], [4, 3], [4, 4], [4, 5],
    [4, 6], [7, 2], [6, 3], [7, 3], [6, 4],
    [0, 8], [3, 9], [4, 9], [5, 9], [0, 0],
    [9, 6], [8, 5], [8, 6], [8, 7], [8, 8],
  ],
}

await runGame(game2Boards, game2Shots); 
*/