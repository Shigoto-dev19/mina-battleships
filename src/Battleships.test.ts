import { 
  Battleships, 
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
import { AttackUtils, BoardUtils } from './client';

export { 
  localDeploy,
  initializeGame,
}

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
  await initTx.sign([deployerKey]).send();
}

describe('Battleships Game Tests', () => {
    let hostKey: PrivateKey,
    joinerKey: PrivateKey, 
    intruderKey: PrivateKey,
    zkappAddress: PublicKey,
    zkappPrivateKey: PrivateKey,
    zkapp: Battleships,
    targetTree: MerkleTree,
    hitTree: MerkleTree,
    hostBoard: number[][],
    joinerBoard: number[][],
    intruderBoard: number[][];
    
    beforeAll(async () => {
      if (proofsEnabled) await Battleships.compile();
  
      // setup local blockchain
      const Local = Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);
  
      // Local.testAccounts is an array of 10 test accounts that have been pre-filled with Mina
      hostKey = Local.testAccounts[0].privateKey;
      joinerKey = Local.testAccounts[1].privateKey;
      intruderKey = Local.testAccounts[2].privateKey;
      
      // zkapp account
      zkappPrivateKey = PrivateKey.random();
      zkappAddress = zkappPrivateKey.toPublicKey();
      zkapp = new Battleships(zkappAddress);

      // initialize local Merkle Tree for target & hit storage
      targetTree = new MerkleTree(8);
      hitTree = new MerkleTree(8);

      // set up the valid host & joiner boards to store on-chain
      hostBoard = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
        [0, 3, 0],
        [0, 4, 0],
      ];

      joinerBoard = [
        [9, 0, 1],
        [9, 5, 1],
        [6, 9, 0],
        [6, 8, 0],
        [7, 7, 0],
      ];

      // set up a local intruder board for testing purposes
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
      
      //TODO: Elaborate on the importance of this test
      it('Initialize game', async () => {
        await initializeGame(zkapp, hostKey);
        
        const player1Id = zkapp.player1Id.get();
        expect(player1Id).toEqual(Field(0));

        const player2Id = zkapp.player2Id.get();
        expect(player2Id).toEqual(Field(0));

        const turns = zkapp.turns.get();
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
      // We test only one invalid case because board correctness is tested separately
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
          let hostGameTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.hostGame(invalidSerializedBoard);
          });

          await hostGameTx.prove();
          await hostGameTx.sign([hostKey]).send();
        }

        expect(rejectedHostTX).rejects.toThrowError('Ship5 is out of board range!');
      });

      it('should host a game and update player1Id', async () => {   
        const hostSerializedBoard = BoardUtils.serialize(hostBoard);
        let hostGameTx = await Mina.transaction(hostKey.toPublicKey(), () => {
          zkapp.hostGame(hostSerializedBoard);
        });
        
        await hostGameTx.prove();
        await hostGameTx.sign([hostKey]).send();

        // compute player1Id locally 
        const computedHostId = BoardUtils.generatePlayerId(hostSerializedBoard, hostKey.toPublicKey());

        // fetch the updated player1Id on-chain
        const hostId = zkapp.player1Id.get();
        
        // assert that the computed host ID is compliant with the ID stored on-chain
        expect(computedHostId).toEqual(hostId);
      });

      it('should prevent other players to re-host a game', async () => {   
        const intruderSerializedBoard = BoardUtils.serialize(intruderBoard);
        const intruderHostTX = async () => {
          let hostGameTx = await Mina.transaction(joinerKey.toPublicKey(), () => {
            zkapp.hostGame(intruderSerializedBoard);
          });

          await hostGameTx.prove();
          await hostGameTx.sign([joinerKey]).send();
        }

        expect(intruderHostTX).rejects.toThrowError('This game has already a host!');
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
            zkapp.joinGame(invalidSerializedBoard);
          });

          await joinGameTx.prove();
          await joinGameTx.sign([joinerKey]).send();
        }
        
        expect(rejectedJoinTX).rejects.toThrowError('Coordinate z should be 1 or 0!');
      });

      it('should join a game and update player2Id', async () => {
        const joinerSerializedBoard = BoardUtils.serialize(joinerBoard);
        let joinGameTx = await Mina.transaction(joinerKey.toPublicKey(), () => {
          zkapp.joinGame(joinerSerializedBoard);
        });
        
        await joinGameTx.prove();
        await joinGameTx.sign([joinerKey]).send();

        // compute player2Id locally 
        const computedjoinerId = BoardUtils.generatePlayerId(joinerSerializedBoard, joinerKey.toPublicKey());

        // fetch the updated player1Id on-chain
        const joinerId = zkapp.player2Id.get()

        // assert that the computed joiner ID is compliant with the ID stored on-chain
        expect(computedjoinerId).toEqual(joinerId);
      });

      it('should prevent other players to join a full game', async () => {
        const intruderSerializedBoard = BoardUtils.serialize(intruderBoard);
        const intruderJoinTX = async () => {
          let joinGameTx = await Mina.transaction(intruderKey.toPublicKey(), () => {
            zkapp.joinGame(intruderSerializedBoard);
          });

          await joinGameTx.prove();
          await joinGameTx.sign([intruderKey]).send();
        }
        
        expect(intruderJoinTX).rejects.toThrowError('This game is already full!');
      });
    });

    describe('firstTurn method tests', () => {
      async function testInvalidFirstTurn(callerKey: PrivateKey, callerBoard: number[][], callerTarget: number[], errorMessage: string, falseTargetIndex=false) {
        let index = zkapp.turns.get().toBigInt();
        let w = targetTree.getWitness(falseTargetIndex ? index + 1n : index);
        let targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(callerBoard);
        const serializedTarget = AttackUtils.serializeTarget(callerTarget);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(callerKey.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([joinerKey]).send();
        }

        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      }

      it('should reject a host with non-compliant board', async () => {
        const errorMessage = 'Only the host is allowed to play the opening shot!';
        // tamper with the host board --> use the intruder board instead --> break integrity
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
        const errorMessage = 'Target storage index is not compliant with turn counter!';
        await testInvalidFirstTurn(hostKey, hostBoard, [3, 9], errorMessage, true);
      });

      it('should reject a non-compliant target off-chain tree: compromised tree', async () => {
        // tamper with the local target Merkle Tree
        targetTree.setLeaf(12n, Field(123));

        const errorMessage = 'Off-chain target merkle tree is out of sync!';
        await testInvalidFirstTurn(hostKey, hostBoard, [3, 4], errorMessage);

        // fix the local target Merkle Tree for later tests
        targetTree.setLeaf(12n, Field(0));
      });

      it('should reject calling attack method before firstTurn', async () => {
        let index = 0n;
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([hostKey]).send();
        }

        const errorMessage = 'Please wait for the host to play the opening shot first!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });

      it('should accept a valid TX and update target on-chain', async () => {
        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        let firstTurnTx = await Mina.transaction(hostKey.toPublicKey(), () => {
          zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([hostKey]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index.toBigInt(), storedTarget); 
      });

      it('should reject calling firstTurn method more than once', async () => {
        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(hostKey.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([hostKey]).send();
        }

        const errorMessage = 'Opening attack can only be played at the beginning of the game!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });
    });

    describe('attack method tests', () => {
      async function testInvalidAttack(playerKey: PrivateKey, board: number[][], errorMessage: string, falseTargetIndex=false, falseHitIndex=false, target?: number[]) {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(falseTargetIndex ? index + 1n : index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(falseHitIndex ? index : index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(board);
        const serializedTarget = AttackUtils.serializeTarget(target ?? [1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(playerKey.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([playerKey]).send();
        }

        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      } 

      async function testValidAttack(playerKey: PrivateKey, board: number[][], shot: number[], expectedHitResult: boolean, expectedHitHistory: number[]) { 
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(board);
        const serializedTarget = AttackUtils.serializeTarget(shot);

        let attackTx = await Mina.transaction(playerKey.toPublicKey(), () => {
          zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([playerKey]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index, storedTarget); 
        
        // fetch the updated hit on-chain
        const storedHitResult = zkapp.hitResult.get();

        // assert that the target is successfully updated
        expect(storedHitResult).toEqual(Bool(expectedHitResult));

        // update the local off-chain hit tree
        hitTree.setLeaf(index -1n, storedHitResult.toField()); 

        // fetch the updated serializedHitHistory on-chain 
        const serializedHitHistory = zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory);
        expect(hitHistory).toEqual(expectedHitHistory.map(Field));

        // fetch & assert the updated turn counter on-chain 
        expect(zkapp.turns.get().toBigInt()).toEqual(index + 1n); 
      }

      it('should reject an invalid target: x coordinate', async () => {
        const errorMessage = 'Target x coordinate is out of bound!';
        testInvalidAttack(joinerKey, joinerBoard, errorMessage, false, false, [12, 5]);
      });

      it('should reject an invalid target: y coordinate', async () => {
        const errorMessage = 'Target y coordinate is out of bound!';
        testInvalidAttack(joinerKey, joinerBoard, errorMessage, false, false, [4, 13]);
      });

      it('should reject an eligible player from taking a turn out of sequence', async () => {
        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        await testInvalidAttack(hostKey, hostBoard, errorMessage);
      });

      it('should reject an intruder player from calling the attack method', async () => {
        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        await testInvalidAttack(intruderKey, joinerBoard, errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: false index', async () => {
        const errorMessage = 'Target storage index is not compliant with turn counter!';
        await testInvalidAttack(joinerKey, joinerBoard, errorMessage, true);
      });

      it('should reject a non-compliant hit off-chain tree: false index', async () => {
        const errorMessage = 'Hit storage index is not in sync with the target Merkle Tree';
        await testInvalidAttack(joinerKey, joinerBoard, errorMessage, false, true);
      });
      
      it('should reject a compromised target off-chain tree', async () => { 
        // tamper with the local target Merkle Tree
        targetTree.setLeaf(3n, AttackUtils.serializeTarget([4, 6]));
  
        const errorMessage = 'Off-chain target merkle tree is out of sync!';
        await testInvalidAttack(joinerKey, joinerBoard, errorMessage);

        // fix the local target Merkle Tree integrity for later tests
        targetTree.setLeaf(3n, Field(0));
      });

      it('should reject a compromised hit off-chain tree', async () => {
        // tamper with the local hit Merkle Tree
        hitTree.setLeaf(3n, Field(1));

        const errorMessage = 'Off-chain hit merkle tree is out of sync!';
        await testInvalidAttack(joinerKey, joinerBoard, errorMessage);

        // fix the local hit Merkle Tree integrity for later tests
        hitTree.setLeaf(3n, Field(0));
      });

      it('should reject eligible player with non-compliant board: joiner', async () => {
        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        // use intruder board instead to break integrity compliance
        await testInvalidAttack(joinerKey, intruderBoard, errorMessage);
      });

      // player2 turn --> turn = 1
      it('should accept a valid attack TX and update state on-chain: 1st check', async () => {
        await testValidAttack(joinerKey, joinerBoard, [0, 0], false, [0, 0]);
      });

      it('should reject eligible player with non-compliant board: host', async () => {
        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        // use intruder board instead to break integrity compliance
        await testInvalidAttack(hostKey, intruderBoard, errorMessage);
      });

      // player1 turn --> turn = 2
      it('should accept a valid attack TX and update state on-chain: 2nd check', async () => {
        await testValidAttack(hostKey, hostBoard, [6, 8], true, [0, 1]);
      });

      // player2 turn --> turn = 3
      it('should accept a valid attack TX and update state on-chain: 3rd check', async () => {
        await testValidAttack(joinerKey, joinerBoard, [0, 1], true, [1, 1]);
      });

      // player1 turn --> turn = 4
      it('should accept a valid attack TX and update state on-chain: 4th check', async () => {
        await testValidAttack(hostKey, hostBoard, [3, 7], true, [1, 2]);
      });
    });      
});

//TODO: Redirect full game test in game.ts that simulated win/lose of one of the players
