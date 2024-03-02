/**
 * This file contains integration tests for the Battleships ZkApp. The ZkApp is deployed and initialized,
 * after which the tests are conducted in sequence to advance the game logic.
 * 
 * The tests check the following aspects:
 * - ZkApp method call restriction to address (e.g., firstTurn restricted to host).
 * - Method call frequency restriction (e.g., one-time execution for hostGame, joinGame, and firstTurn methods).
 * - Method sequence (e.g., ensuring that certain methods are called in the correct order, like firstTurn before attack).
 * - Input validity (e.g., checking ranges, sizes, integrity of hashes, salts, boards, etc.).
 * - Correctness of on-chain state updates.
 * - Compliance of off-chain state storage.
 */

import { 
  BattleshipsZkApp, 
  TargetMerkleWitness,
  HitMerkleWitness,
  EMPTY_TREE8_ROOT,
} from './Battleships';
import {
  Field, 
  Mina,
  AccountUpdate,
  PrivateKey,
  PublicKey,
  UInt8,
  MerkleTree,
  Bool,
} from 'o1js';
import { AttackUtils, BoardUtils } from './provableUtils';

const proofsEnabled = false;

async function localDeploy(
  zkapp: BattleshipsZkApp, 
  deployerKey: PrivateKey,
  zkappPrivateKey: PrivateKey
) { 
  const deployerAccount = deployerKey.toPublicKey();
  const tx = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkapp.deploy();
  });
  
  await tx.prove();
  await tx.sign([deployerKey, zkappPrivateKey]).send();
}

async function initializeGame(zkapp: BattleshipsZkApp, deployerKey: PrivateKey) {
  const deployerAccount = deployerKey.toPublicKey();
  
  // The deployer initializes the Battleships zkapp
  const initTx = await Mina.transaction(deployerAccount, () => {
    zkapp.initGame();
  });

  await initTx.prove();
  await initTx.sign([deployerKey]).send();
}

describe('Battleships Game Tests', () => {
    let hostKey: PrivateKey,
    joinerKey: PrivateKey, 
    intruderKey: PrivateKey,
    zkappAddress: PublicKey,
    zkappPrivateKey: PrivateKey,
    zkapp: BattleshipsZkApp,
    targetTree: MerkleTree,
    hitTree: MerkleTree,
    hostBoard: number[][],
    hostSalt: Field,
    joinerBoard: number[][],
    joinerSalt: Field,
    intruderBoard: number[][];
    
    beforeAll(async () => {
      if (proofsEnabled) await BattleshipsZkApp.compile();
  
      // Set up the Mina local blockchain
      const Local = Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);
  
      // Local.testAccounts is an array of 10 test accounts that have been pre-filled with Mina
      hostKey = Local.testAccounts[0].privateKey;
      joinerKey = Local.testAccounts[1].privateKey;
      intruderKey = Local.testAccounts[2].privateKey;
      
      // Set up the zkapp account
      zkappPrivateKey = PrivateKey.random();
      zkappAddress = zkappPrivateKey.toPublicKey();
      zkapp = new BattleshipsZkApp(zkappAddress);

      // Initialize the off-chain Merkle Tree for target & hit storage respectively
      targetTree = new MerkleTree(8);
      hitTree = new MerkleTree(8);

      // Set up valid host & joiner boards
      hostBoard = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
        [0, 3, 0],
        [0, 4, 0],
      ];
      hostSalt = Field.random();

      joinerBoard = [
        [9, 0, 1],
        [9, 5, 1],
        [6, 9, 0],
        [6, 8, 0],
        [7, 7, 0],
      ];
      joinerSalt = Field.random();

      // Set up a valid intruder board for testing purposes
      intruderBoard = [
        [3, 2, 0],
        [8, 4, 1],
        [7, 0, 0],
        [0, 9, 0],
        [8, 8, 0],
      ];
    });

    describe('Deploy and initialize Battleships zkApp', () => {
      it('Generate and Deploy `Battleships` smart contract', async () => {
        await localDeploy(zkapp, hostKey, zkappPrivateKey);
      });
      
      // This is test verifies that the zkapp initial state values are correctly set up
      it('Initialize game', async () => {
        await initializeGame(zkapp, hostKey);
        
        const player1Id = zkapp.player1Id.get();
        expect(player1Id).toEqual(Field(0));

        const player2Id = zkapp.player2Id.get();
        expect(player2Id).toEqual(Field(0));

        const turns = zkapp.turnCount.get();
        expect(turns). toEqual(new UInt8(0));

        const targetRoot = zkapp.targetRoot.get();
        expect(targetRoot).toEqual(EMPTY_TREE8_ROOT);
        
        const hitRoot = zkapp.hitRoot.get();
        expect(hitRoot).toEqual(EMPTY_TREE8_ROOT);

        const serializedHitHistory = zkapp.serializedHitHistory.get();
        expect(serializedHitHistory).toEqual(Field(0));
      });
    });

    describe('hostGame method tests', () => {
      // We test only one invalid case because because board correctness is tested separately
      it('should reject host with invalid board', () => {
        const invalidHostBoard = [
          [9, 0, 1],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [10, 7, 0],
        ];
        
        const invalidSerializedBoard = BoardUtils.serialize(invalidHostBoard);
        const rejectedHostTX = async () => {
          const hostGameTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.hostGame(invalidSerializedBoard, hostSalt);
          });

          await hostGameTx.prove();
          await hostGameTx.sign([hostKey]).send();
        }

        expect(rejectedHostTX).rejects.toThrowError('Ship5 is out of board range!');
      });

      it('should host a game and update player1Id', async () => {   
        const hostSerializedBoard = BoardUtils.serialize(hostBoard);
        
        const hostGameTx = await Mina.transaction(hostKey.toPublicKey(), () => {
          zkapp.hostGame(hostSerializedBoard, hostSalt);
        });
        
        await hostGameTx.prove();
        await hostGameTx.sign([hostKey]).send();

        // Compute player1 ID locally 
        const computedHostId = BoardUtils.generatePlayerId(
          hostSerializedBoard, 
          hostKey.toPublicKey(), 
          hostSalt
        );

        // Fetch the updated on-chain player1 ID 
        const hostId = zkapp.player1Id.get();
        
        // Assert that the computed host ID is compliant with the ID stored on-chain
        expect(computedHostId).toEqual(hostId);
      });

      it('should prevent other players from re-hosting a game', async () => {   
        const intruderSerializedBoard = BoardUtils.serialize(intruderBoard);

        const intruderHostTX = async () => {
          const hostGameTx = await Mina.transaction(joinerKey.toPublicKey(), () => {
            zkapp.hostGame(intruderSerializedBoard, hostSalt);
          });

          await hostGameTx.prove();
          await hostGameTx.sign([joinerKey]).send();
        }

        expect(intruderHostTX).rejects.toThrowError('This game already has a host!');
      });
    });

    describe('joinGame method tests', () => {
      it('should reject a joiner with invalid board', () => {
        const invalidJoinerBoard = [
          [9, 0, 2],
          [9, 5, 1],
          [6, 9, 0],
          [6, 8, 0],
          [7, 7, 0],
        ];
        
        const invalidSerializedBoard = BoardUtils.serialize(invalidJoinerBoard);

        const rejectedJoinTX = async () => {
          let joinGameTx = await Mina.transaction(joinerKey.toPublicKey(), () => {
            zkapp.joinGame(invalidSerializedBoard, joinerSalt);
          });

          await joinGameTx.prove();
          await joinGameTx.sign([joinerKey]).send();
        }
        
        expect(rejectedJoinTX).rejects.toThrowError('Coordinate z should be 1 or 0!');
      });

      it('should join a game and update player2Id', async () => {
        const joinerSerializedBoard = BoardUtils.serialize(joinerBoard);

        const joinGameTx = await Mina.transaction(joinerKey.toPublicKey(), () => {
          zkapp.joinGame(joinerSerializedBoard, joinerSalt);
        });
        
        await joinGameTx.prove();
        await joinGameTx.sign([joinerKey]).send();

        // Compute player2 ID locally 
        const computedjoinerId = BoardUtils.generatePlayerId(
          joinerSerializedBoard, 
          joinerKey.toPublicKey(), 
          joinerSalt
        );

        // Fetch the updated on-chain player1 ID
        const joinerId = zkapp.player2Id.get()

        // Assert that the computed joiner ID is compliant with the ID stored on-chain
        expect(computedjoinerId).toEqual(joinerId);
      });

      it('should prevent other players to join a full game', async () => {
        const intruderSerializedBoard = BoardUtils.serialize(intruderBoard);

        const intruderJoinTX = async () => {
          const joinGameTx = await Mina.transaction(intruderKey.toPublicKey(), () => {
            zkapp.joinGame(intruderSerializedBoard, joinerSalt);
          });

          await joinGameTx.prove();
          await joinGameTx.sign([intruderKey]).send();
        }
        
        expect(intruderJoinTX).rejects.toThrowError('This game is already full!');
      });
    });

    describe('firstTurn method tests', () => {
      async function testInvalidFirstTurn(
        callerKey: PrivateKey, 
        callerBoard: number[][], 
        callerTarget: number[], 
        errorMessage: string, 
        falseTargetIndex=false
      ) {
        const index = zkapp.turnCount.get().toBigInt();
        const w = targetTree.getWitness(falseTargetIndex ? index + 1n : index);
        const targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(callerBoard);

        const serializedTarget = AttackUtils.serializeTarget(callerTarget);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(callerKey.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, hostSalt, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([joinerKey]).send();
        }

        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      }

      it('should reject a host with non-compliant board', async () => {
        const errorMessage = 'Only the host is allowed to play the opening shot!';
        // Tamper with the host board --> use the intruder board instead --> break integrity
        testInvalidFirstTurn(hostKey, intruderBoard, [1, 2], errorMessage);
      });

      it('should reject any caller other than the host', async () => {
        const errorMessage = 'Only the host is allowed to play the opening shot!';
        await testInvalidFirstTurn(joinerKey, joinerBoard, [0, 7], errorMessage);
      });

      it('should reject an invalid target: x coordinate', async () => {
        const errorMessage = 'Target x coordinate is out of bound!';
        await testInvalidFirstTurn(hostKey, hostBoard, [10, 7], errorMessage);
      });

      it('should reject an invalid target: y coordinate', async () => {
        const errorMessage = 'Target y coordinate is out of bound!';
        await testInvalidFirstTurn(hostKey, hostBoard, [3, 11], errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: empty leaf/ false index', async () => {
        const errorMessage = 'Target storage index is not compliant with the turn counter!';
        await testInvalidFirstTurn(hostKey, hostBoard, [3, 9], errorMessage, true);
      });

      it('should reject a non-compliant target off-chain tree: compromised tree', async () => {
        // Tamper with the local target Merkle Tree
        targetTree.setLeaf(12n, Field(123));

        const errorMessage = 'Off-chain target Merkle Tree is out of sync!';
        await testInvalidFirstTurn(hostKey, hostBoard, [3, 4], errorMessage);

        // Fix the local target Merkle Tree for later tests
        targetTree.setLeaf(12n, Field(0));
      });

      it('should reject calling attack method before firstTurn', async () => {
        const index = 0n;
        const wTarget = targetTree.getWitness(index);
        const targetWitness = new TargetMerkleWitness(wTarget);

        const hTarget = hitTree.getWitness(index);
        const hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          const attackTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, hostSalt, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([hostKey]).send();
        }

        const errorMessage = 'Please wait for the host to play the opening shot first!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });

      it('should accept a valid TX and update target on-chain', async () => {
        const index = zkapp.turnCount.get();
        const w = targetTree.getWitness(index.toBigInt());
        const targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const firstTurnTx = await Mina.transaction(hostKey.toPublicKey(), () => {
          zkapp.firstTurn(serializedTarget, serializedBoard, hostSalt, targetWitness);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([hostKey]).send();

        // Fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // Assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // Update the local off-chain target tree
        targetTree.setLeaf(index.toBigInt(), storedTarget); 
      });

      it('should reject calling firstTurn method more than once', async () => {
        const index = zkapp.turnCount.get();
        const w = targetTree.getWitness(index.toBigInt());
        const targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          const firstTurnTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, hostSalt, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([hostKey]).send();
        }

        const errorMessage = 'Opening attack can only be played at the beginning of the game!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });
    });

    describe('attack method tests', () => {
      async function testInvalidAttack(
        playerKey: PrivateKey, 
        board: number[][], 
        playerSalt: Field, 
        errorMessage: string, 
        falseTargetIndex=false, 
        falseHitIndex=false, 
        target?: number[]
      ) {
        const index = zkapp.turnCount.get().toBigInt();
        const wTarget = targetTree.getWitness(falseTargetIndex ? index + 1n : index);
        const targetWitness = new TargetMerkleWitness(wTarget);

        const hTarget = hitTree.getWitness(falseHitIndex ? index : index - 1n);
        const hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(board);
        const serializedTarget = AttackUtils.serializeTarget(target ?? [1, 2]);

        const rejectedAttackTx = async () => {
          const attackTx = await Mina.transaction(playerKey.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, playerSalt, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([playerKey]).send();
        }

        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      } 

      async function testValidAttack(
        playerKey: PrivateKey, 
        board: number[][], 
        playerSalt: Field, 
        target: number[], 
        expectedHitResult: boolean, 
        expectedHitHistory: number[]
      ) { 
        const index = zkapp.turnCount.get().toBigInt();
        const wTarget = targetTree.getWitness(index);
        const targetWitness = new TargetMerkleWitness(wTarget);

        const hTarget = hitTree.getWitness(index - 1n);
        const hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(board);
        const serializedTarget = AttackUtils.serializeTarget(target);

        const attackTx = await Mina.transaction(playerKey.toPublicKey(), () => {
          zkapp.attack(serializedTarget, serializedBoard, playerSalt, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([playerKey]).send();

        // Fetch the updated on-chain target
        const storedTarget = zkapp.target.get();

        // Assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // Update the local off-chain target tree
        targetTree.setLeaf(index, storedTarget); 
        
        // Fetch the updated on-chain hit 
        const storedHitResult = zkapp.hitResult.get();

        // Assert that the target is successfully updated
        expect(storedHitResult).toEqual(Bool(expectedHitResult));

        // Update the local off-chain hit tree
        hitTree.setLeaf(index -1n, storedHitResult.toField()); 

        // Fetch the updated on-chain serializedHitHistory  
        const serializedHitHistory = zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory)[0];
        expect(hitHistory).toEqual(expectedHitHistory.map(Field));

        // Fetch & assert the updated on-chain turn counter  
        expect(zkapp.turnCount.get().toBigInt()).toEqual(index + 1n); 
      }

      it('should reject an invalid target: x coordinate', async () => {
        const errorMessage = 'Target x coordinate is out of bound!';
        testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage, false, false, [12, 5]);
      });

      it('should reject an invalid target: y coordinate', async () => {
        const errorMessage = 'Target y coordinate is out of bound!';
        testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage, false, false, [4, 13]);
      });

      it('should reject an eligible player from taking a turn out of sequence', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        await testInvalidAttack(hostKey, hostBoard, hostSalt, errorMessage);
      });

      it('should reject an intruder player from calling the attack method', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        await testInvalidAttack(intruderKey, joinerBoard, joinerSalt, errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: false index', async () => {
        const errorMessage = 'Target storage index is not compliant with the turn counter!';
        await testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage, true);
      });

      it('should reject a non-compliant hit off-chain tree: false index', async () => {
        const errorMessage = 'Hit storage index is not in sync with the target Merkle Tree';
        await testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage, false, true);
      });
      
      it('should reject a compromised target off-chain tree', async () => { 
        // Tamper with the local target Merkle Tree
        targetTree.setLeaf(3n, AttackUtils.serializeTarget([4, 6]));
  
        const errorMessage = 'Off-chain target Merkle Tree is out of sync!';
        await testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage);

        // Fix the local target Merkle Tree integrity for later tests
        targetTree.setLeaf(3n, Field(0));
      });

      it('should reject a compromised hit off-chain tree', async () => {
        // Tamper with the local hit Merkle Tree
        hitTree.setLeaf(3n, Field(1));

        const errorMessage = 'Off-chain hit Merkle Tree is out of sync!';
        await testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage);

        // Fix the local hit Merkle Tree integrity for later tests
        hitTree.setLeaf(3n, Field(0));
      });

      it('should reject eligible player with non-compliant board: joiner', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        // Use intruder board instead to break integrity compliance
        await testInvalidAttack(joinerKey, intruderBoard, joinerSalt, errorMessage);
      });

      it('should reject eligible player with non-compliant salt: joiner', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        // Use a different random salt
        await testInvalidAttack(joinerKey, joinerBoard, Field.random(), errorMessage);
      });

      // player2 turn --> turn = 1 --> report Player1 Miss
      it('should accept a valid attack TX and update state on-chain: 1st check', async () => {
        await testValidAttack(joinerKey, joinerBoard, joinerSalt, [0, 0], false, [0, 0]);
      });

      it('should reject eligible player with non-compliant board: host', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        // Use intruder board instead to break integrity compliance
        await testInvalidAttack(hostKey, intruderBoard, hostSalt, errorMessage);
      });

      it('should reject eligible player with non-compliant salt: host', async () => {
        const errorMessage = "Invalid Action: either your Player ID is not compliant or it's not your turn yet!";
        // Use a different random salt
        await testInvalidAttack(hostKey, joinerBoard, Field.random(), errorMessage);
      });

      // player1 turn --> turn = 2 --> report player2 Hit
      it('should accept a valid attack TX and update state on-chain: 2nd check', async () => {
        await testValidAttack(hostKey, hostBoard, hostSalt, [6, 8], true, [0, 1]);
      });

      it('should reject player2 selecting a nullified target that caused a hit', async () => {
        const errorMessage = 'Invalid Target! Please select a unique target!' 
        await testInvalidAttack(joinerKey, joinerBoard, joinerSalt, errorMessage, false, false, [0, 0]);
      });

      // player2 turn --> turn = 3 -->  report player1 Hit
      it('should accept a valid attack TX and update state on-chain: 3rd check', async () => {
        await testValidAttack(joinerKey, joinerBoard, joinerSalt, [0, 1], true, [1, 1]);
      });

      it('should reject player1 selecting a nullified target that caused a hit', async () => {
        const errorMessage = 'Invalid Target! Please select a unique target!' 
        await testInvalidAttack(hostKey, hostBoard, hostSalt, errorMessage, false, false, [6, 8]);
      });

      // player1 turn --> turn = 4 --> report player2 Hit
      it('should accept a valid attack TX and update state on-chain: 4th check', async () => {
        await testValidAttack(hostKey, hostBoard, hostSalt, [3, 7], true, [1, 2]);
      });
      
      // player2 turn --> turn = 5 --> report player1 Miss
      it('should accept a valid attack TX and update state on-chain: 5th check', async () => {
        await testValidAttack(joinerKey, joinerBoard, joinerSalt, [9, 0], false, [1, 2]);
      });

      // player1 turn --> turn = 6 --> report player2 Miss
      it('should accept player1 sending a valid attack TX choosing a previous target that was a MISS: 6th check', async () => {
        await testValidAttack(hostKey, hostBoard, hostSalt, [3, 7], false, [1, 2]);
      });

      // player2 turn --> turn = 7 --> report player1 Miss
      it('should accept player2 sending a valid attack TX choosing a previous target that was a MISS: 7th check', async () => {
        await testValidAttack(joinerKey, joinerBoard, joinerSalt, [9, 0], false, [1, 2]);
      });
    });      
});  