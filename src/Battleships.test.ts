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
  Provable,
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
  await initTx.sign([deployerKey]).send();
}


describe('Battleships Game Tests', () => {
   
    let player1Key: PrivateKey,
    player2Key: PrivateKey, 
    intruderKey: PrivateKey,
    zkappAddress: PublicKey,
    zkappPrivateKey: PrivateKey,
    zkapp: Battleships,
    targetTree: MerkleTree,
    hitTree: MerkleTree;
  
    beforeAll(async () => {
      if (proofsEnabled) await Battleships.compile();
  
      // setup local blockchain
      const Local = Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);
  
      // Local.testAccounts is an array of 10 test accounts that have been pre-filled with Mina
      player1Key = Local.testAccounts[0].privateKey;
      player2Key = Local.testAccounts[1].privateKey;
      intruderKey = Local.testAccounts[2].privateKey;
      
      // zkapp account
      zkappPrivateKey = PrivateKey.random();
      zkappAddress = zkappPrivateKey.toPublicKey();
      zkapp = new Battleships(zkappAddress);

      // initialize local Merkle Tree for target & hit storage
      targetTree = new MerkleTree(8);
      hitTree = new MerkleTree(8);
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

        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(player2Board);
        const serializedTarget = AttackUtils.serializeTarget([0, 7]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
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

        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([10, 7]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
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

        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 11]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Target y coordinate is out of bound!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: empty leaf/ false index', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        let index = 2n;
        let w = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 9]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Target storage index is not compliant with turn counter!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it.skip('should reject a non-compliant target off-chain tree: full leaf / correct index', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        let index = 0n;
        targetTree.setLeaf(0n, Field(123));
        let w = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Off-chain target merkle tree is out of sync!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: compromised tree', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        let index = 12n;
        targetTree.setLeaf(index, Field(123));
        let w = targetTree.getWitness(0n);
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Off-chain target merkle tree is out of sync!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });

      it('should accept a valid TX and update target on-chain', async () => {
        targetTree = new MerkleTree(8);
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
          zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
        });

        await firstTurnTx.prove();
        await firstTurnTx.sign([player1Key]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index.toBigInt(), storedTarget); 
      });

      it('should reject calling the method more than once', async () => {
        const hostBoard = [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
          [0, 3, 0],
          [0, 4, 0],
        ];

        let index = zkapp.turns.get();
        let w = targetTree.getWitness(index.toBigInt());
        let targetWitness = new TargetMerkleWitness(w);
        
        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([3, 4]);

        const rejectedFirstTurnTx = async () => {
          let firstTurnTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.firstTurn(serializedTarget, serializedBoard, targetWitness);
          });

          await firstTurnTx.prove();
          await firstTurnTx.sign([player1Key]).send();
        }

        const errorMessage = 'Opening attack can only be played at the beginning of the game!';
        expect(rejectedFirstTurnTx).rejects.toThrowError(errorMessage);
      });
      //TODO add test case when for attack before firstTurn
    });

    describe('attack method tests', () => {
      // The correct(on-chain) player1(host) board
      const hostBoard = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
        [0, 3, 0],
        [0, 4, 0],
      ];
      
      // The correct(on-chain) player1(host) board
      const joinerBoard = [
        [9, 0, 1],
        [9, 5, 1],
        [6, 9, 0],
        [6, 8, 0],
        [7, 7, 0],
      ];

      it('should reject an eligible player from taking a turn out of sequence', () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(player1Key.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([player1Key]).send();
        }

        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });

      it('should reject an intruder player from calling the attack method', () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(intruderKey.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([intruderKey]).send();
        }

        const errorMessage = 'You are not allowed to attack! Please wait for your adversary to take action!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });

      it('should reject a non-compliant target off-chain tree: false index', () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index + 3n);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([player2Key]).send();
        }

        const errorMessage = 'Target storage index is not compliant with turn counter!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });

      it('should reject a non-compliant hit off-chain tree: false index', () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index + 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([player2Key]).send();
        }

        const errorMessage = 'Hit storage index is not in sync with the target Merkle Tree';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);
      });
      
      it('should reject a compromised target off-chain tree', () => { 
        // tamper with the local target Merkle Tree
        targetTree.setLeaf(3n, AttackUtils.serializeTarget([4, 6]));
  
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([player2Key]).send();
        }

        const errorMessage = 'Off-chain target merkle tree is out of sync!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);

        // fix the local target Merkle Tree integrity for later tests
        targetTree.setLeaf(3n, Field(0));
      });

      it('should reject a compromised hit off-chain tree', () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        // tamper with the local hit Merkle Tree
        hitTree.setLeaf(3n, Field(1));

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([1, 2]);

        const rejectedAttackTx = async () => {
          let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
            zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
          });

          await attackTx.prove();
          await attackTx.sign([player2Key]).send();
        }

        const errorMessage = 'Off-chain hit merkle tree is out of sync!';
        expect(rejectedAttackTx).rejects.toThrowError(errorMessage);

        // fix the local hit Merkle Tree integrity for later tests
        hitTree.setLeaf(3n, Field(0));
      });

      // player2 turn --> turns = 1
      it('should accept a valid attack TX and update state on-chain: 1st check', async () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(joinerBoard);
        const serializedTarget = AttackUtils.serializeTarget([0, 0]);

        let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
          zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([player2Key]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index + 1n, storedTarget); 
        
        // fetch the updated hit on-chain
        const storedHitResult = zkapp.hitResult.get();

        // assert that the target is successfully updated: [3, 4] scanned to player2 Board is a miss=Bool(false)
        expect(storedHitResult).toEqual(Bool(false));

        // update the local off-chain hit tree
        hitTree.setLeaf(index -1n, storedHitResult.toField()); 

        // fetch the updated serializedHitHistory on-chain 
        const serializedHitHistory = zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory);
        expect(hitHistory).toEqual([0, 0].map(Field));

        // fetch & assert the updated turn counter on-chain 
        expect(zkapp.turns.get().toBigInt()).toEqual(index + 1n);
      });

      // player1 turn --> turn = 2
      it('should accept a valid attack TX and update state on-chain: 2nd check', async () => {
        let index = zkapp.turns.get().toBigInt();
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(hostBoard);
        const serializedTarget = AttackUtils.serializeTarget([6, 8]);

        let attackTx = await Mina.transaction(player1Key.toPublicKey(), () => {
          zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([player1Key]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index + 1n, storedTarget);
        
        // fetch the updated hit on-chain
        const storedHitResult = zkapp.hitResult.get();

        // assert that the hitResult is successfully updated: [0, 0] scanned to player1 Board is a hit=Bool(true)
        expect(storedHitResult).toEqual(Bool(true));

        // update the local off-chain hit tree
        hitTree.setLeaf(index -1n, storedHitResult.toField()); 

        // fetch the updated serializedHitHistory on-chain 
        const serializedHitHistory = zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory);
        expect(hitHistory).toEqual([0, 1].map(Field));

        // fetch & assert the updated turn counter on-chain 
        expect(zkapp.turns.get().toBigInt()).toEqual(index + 1n);
      });

      // player2 turn --> turn = 3
      it('should accept a valid attack TX and update state on-chain: 3rd check', async () => {
        let index = zkapp.turns.get().toBigInt();
        Provable.log('latest leaf: ', AttackUtils.deserializeTarget(targetTree.getNode(0, 2n)));
        let wTarget = targetTree.getWitness(index);
        let targetWitness = new TargetMerkleWitness(wTarget);

        let hTarget = hitTree.getWitness(index - 1n);
        let hitWitness = new HitMerkleWitness(hTarget);

        const serializedBoard = BoardUtils.serialize(joinerBoard);
        const serializedTarget = AttackUtils.serializeTarget([0, 1]);

        let attackTx = await Mina.transaction(player2Key.toPublicKey(), () => {
          zkapp.attack(serializedTarget, serializedBoard, targetWitness, hitWitness);
        });

        await attackTx.prove();
        await attackTx.sign([player2Key]).send();

        // fetch the updated target on-chain
        const storedTarget = zkapp.target.get();

        // assert that the target is successfully updated
        expect(storedTarget).toEqual(serializedTarget);

        // update the local off-chain target tree
        targetTree.setLeaf(index + 1n, storedTarget); 
        
        // fetch the updated hit on-chain
        const storedHitResult = zkapp.hitResult.get();

        // assert that the target is successfully updated: [6, 8] scanned to player2 Board is a hit=Bool(true)
        expect(storedHitResult).toEqual(Bool(true));

        // update the local off-chain hit tree
        hitTree.setLeaf(index -1n, storedHitResult.toField()); 

        // fetch the updated serializedHitHistory on-chain 
        const serializedHitHistory = zkapp.serializedHitHistory.get();
        const hitHistory = AttackUtils.deserializeHitHistory(serializedHitHistory);
        expect(hitHistory).toEqual([1, 1].map(Field));

        // fetch & assert the updated turn counter on-chain 
        expect(zkapp.turns.get().toBigInt()).toEqual(index + 1n);
      });
    });      
});

//TODO: Refactor tests
//TODO: Redirect full game test in game.ts that simulated win/lose of one of the players
