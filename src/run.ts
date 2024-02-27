import { Battleships } from './Battleships.js';
import { BattleShipsClient } from './client.js';
import {
    Mina,
    AccountUpdate,
    PrivateKey,
    PublicKey,
} from 'o1js';

//TODO Add feedback to add a variable that fetches state from the zkapp --> let state-on-chain = zkapp.state.get();
const proofsEnabled = false;
//TODO separate each player merkle tree for both target & hit

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

// inline ephemeral logging
function printLog(msg: string) {
  if (process.stdout.isTTY) {
    process.stdout.clearLine(-1);
    process.stdout.cursorTo(0);
    process.stdout.write(msg);
  }
}

//TODO bundle player's: board - shots - targetTree - hitTree
// x, y, z (horizontal/ verical orientation) ship placements
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
// shots alice(host) to hit / bob(joiner) to miss
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
      [9, 0], [8, 9], [8, 8],
      [8, 7], [8, 6], [8, 5],
      [8, 4], [8, 5]
  ]
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

    // initialize local Merkle Tree for target & hit storage - for each player
    host = BattleShipsClient.initialize(zkapp, hostKey, gameBoard.host);
    joiner = BattleShipsClient.initialize(zkapp, joinerKey, gameBoard.joiner);

    // deploy and initialize game
    await localDeploy(zkapp, hostKey, zkappPrivateKey);
    await initializeGame(zkapp, hostKey);

    console.log('Host new game');
    await host.hostGame();
    host.printGameData();

    console.log('Join the game');
    await joiner.joinGame();
    joiner.printGameData();

    console.log('Host plays opening shot');
    await host.playFirstTurn(gameShots.host[0]);


    console.log('Alternate playing turns!');
    for (let player1_nonce = 1; player1_nonce <= 16; player1_nonce++) {
        printLog(`Bob reporting result of Alice shot #${player1_nonce - 1} (Turn ${player1_nonce * 2 - 1})`)
        /// BOB PROVES ALICE PREVIOUS REGISTERED SHOT HIT ///
        // bob's shot hit/miss integrity proof public / private inputs
        await joiner.playTurn(
            gameShots.joiner[player1_nonce - 1]
        );

        /// ALICE PROVES BOB PREV REGISTERED SHOT MISSED ///
        printLog(`Alice reporting result of Bob shot #${player1_nonce - 1} (Turn ${player1_nonce * 2})`)
        // bob's shot hit/miss integrity proof public / private inputs
        
        await host.playTurn(
            gameShots.host[player1_nonce]
        );
    }  

    console.log('\nAlice wins on sinking all of Bob\'s ships');
    await joiner.playTurn(
        gameShots.joiner[16]
    );
    
    host.printGameData();
    joiner.printGameData();
}

await runGame(game1Boards, game1Shots);

const game2Boards = {
    host: [
        [4, 2, 1],
        [1, 1, 0],
        [8, 6, 1],
        [3, 9, 0],
        [6, 3, 1]
    ],
    joiner: [
        [1, 8, 0],
        [0, 3, 1],
        [3, 1, 1],
        [8, 5, 1],
        [8, 9, 0]
    ]
  }
  
  const game2Shots = {
    host: [
        [1, 0], [2, 2], [0, 5], [0, 6], [0, 7],
        [0, 3], [2, 9], [6, 4], [3, 1], [3, 2],
        [3, 0], [3, 3], [3, 4], [4, 6], [2, 4],
        [6, 6], [5, 7], [5, 8], [5, 9], [4, 8],
        [3, 8], [2, 8], [1, 8], [6, 7], [7, 3]
    ],
    joiner: [
        [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
        [5, 1], [4, 2], [4, 3], [4, 4], [4, 5],
        [4, 6], [7, 2], [6, 3], [7, 3], [6, 4],
        [0, 8], [3, 9], [4, 9], [5, 9], [0, 0],
        [9, 6], [8, 5], [8, 6], [8, 7], [8, 8]
    ]
  }

await runGame(game2Boards, game2Shots);