import { Battleships } from './Battleships';
import {
  Field, 
  Mina,
  AccountUpdate,
  PrivateKey,
  PublicKey,
  UInt8,
} from 'o1js';
import { AttackUtils, BoardUtils } from './client';

const proofsEnabled = false;

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
  // await initTxn.sign([deployerKey]).send();
}


describe('Battleships Game Tests', () => {
   
    let player1Key: PrivateKey,
    player2Key: PrivateKey, 
    zkappAddress: PublicKey,
    zkappPrivateKey: PrivateKey,
    zkapp: Battleships;
  
    beforeAll(async () => {
      if (proofsEnabled) await Battleships.compile();
  
      // setup local blockchain
      const Local = Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);
  
      // Local.testAccounts is an array of 10 test accounts that have been pre-filled with Mina
      player1Key = Local.testAccounts[0].privateKey;
      player2Key = Local.testAccounts[1].privateKey;
      
      // zkapp account
      zkappPrivateKey = PrivateKey.random();
      zkappAddress = zkappPrivateKey.toPublicKey();
      zkapp = new Battleships(zkappAddress);
    });

    describe('Deploy and initialize Battleships zkApp', () => {
      it('Generate and Deploy `Battleships` smart contract', async () => {
        await localDeploy(zkapp, player1Key, zkappPrivateKey);
      });

      it('Initialize game', async () => {
        await initializeGame(zkapp, player1Key);
        
        const player1Id = zkapp.player1Id.get();
        expect(player1Id).toEqual(Field(0));

        const player2Id = zkapp.player2Id.get();
        expect(player2Id).toEqual(Field(0));

        const turns = zkapp.turns.get();
        expect(turns).toEqual(UInt8.from(0));

        
        const hitHistory = zkapp.hitHistory.get();
        expect(hitHistory).toEqual(Field(0));
      });
    });

    describe('hostGame method tests', () => {
      it('should host a game and update player1Id', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];
        
        const hostSerializedBoard = BoardUtils.serialize(hostBoard);
        let hostGameTx = await Mina.transaction(player1Key.toPublicKey(), () => {
          zkapp.hostGame(hostSerializedBoard);
        });
        
        await hostGameTx.prove();
        await hostGameTx.sign([player1Key]).send();

        // compute player1Id locally 
        const computedHostId = BoardUtils.generatePlayerId(hostSerializedBoard, player1Key.toPublicKey());

        // fetch the updated player1Id on-chain
        const hostId = zkapp.player1Id.get();
        
        // assert that the computed host ID is compliant with the ID stored on-chain
        expect(computedHostId).toEqual(hostId);
      });

      it('should prevent other players to re-host a game', async () => {
        const meddlerBoard = [
          [9, 0, 1],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [7, 7, 0],
        ];
        
        const meddlerSerializedBoard = BoardUtils.serialize(meddlerBoard);
        const meddlerHostTX = async () => {
          let hostGameTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.hostGame(meddlerSerializedBoard);
          });

          await hostGameTx.prove();
          await hostGameTx.sign([player2Key]).send();
        }

        expect(meddlerHostTX).rejects.toThrowError('This game has already a host!');
      });
    });

    describe('joinGame method tests', () => {
      it('should join a game and update player2Id', async () => {
        const joinerBoard = [
          [9, 0, 1],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [7, 7, 0],
        ];

        const joinerSerializedBoard = BoardUtils.serialize(joinerBoard);
        let joinGameTx = await Mina.transaction(player2Key.toPublicKey(), () => {
          zkapp.joinGame(joinerSerializedBoard);
        });
        
        await joinGameTx.prove();
        await joinGameTx.sign([player2Key]).send();

        // compute player2Id locally 
        const computedjoinerId = BoardUtils.generatePlayerId(joinerSerializedBoard, player2Key.toPublicKey());

        // fetch the updated player1Id on-chain
        const joinerId = zkapp.player2Id.get()

        // assert that the computed joiner ID is compliant with the ID stored on-chain
        expect(computedjoinerId).toEqual(joinerId);
      });

      it('should prevent other players to join a full game', async () => {
        const meddlerBoard = [
          [9, 0, 1],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [7, 7, 0],
        ];
        
        const meddlerSerializedBoard = BoardUtils.serialize(meddlerBoard);
        const meddlerJoinTX = async () => {
          let joinGameTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.joinGame(meddlerSerializedBoard);
          });

          await joinGameTx.prove();
          await joinGameTx.sign([player1Key]).send();
        }
        
        expect(meddlerJoinTX).rejects.toThrowError('This game is already full!');
      });
    });

    describe('firstTurn method tests', () => {
      it('should reject any caller other than the host', async () => {
        const player2Board = [
          [9, 0, 1],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [7, 7, 0],
        ];

        const serializedBoard = BoardUtils.serialize(player2Board);
        const serializedTarget = AttackUtils.serializeTarget([0, 7]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player2Key]).send();
        }

        const errorMessage = 'Only the host is allowed to play the opening shot!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should reject an invalid target: x coordinate', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([10, 7]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Target x coordinate is out of bound!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should reject an invalid target: y coordinate', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 11]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Target y coordinate is out of bound!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should accept a valid TX and update target on-chain', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
          zkapp.firstTurn(serializedTarget, serializedBoard);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([player1Key]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);
      });

      it('should reject calling the method more than once', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Opening attack can only be played at the beginning of the game!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });
    });
});
