import { 
    Field, 
    UInt8,
    state, 
    State,
    method,
    SmartContract, 
    Provable,
    Poseidon,
    Bool,
    MerkleWitness,
} from 'o1js';

import { 
    BoardUtils,
    BoardCircuit, 
    AttackUtils,
    AttackCircuit, 
} from './provableUtils.js'; 

export { 
    BattleshipsZkApp,
    TargetMerkleWitness,
    HitMerkleWitness, 
    EMPTY_TREE8_ROOT,
}

const EMPTY_TREE8_ROOT = Field(14472842460125086645444909368571209079194991627904749620726822601198914470820n);

class TargetMerkleWitness extends MerkleWitness(8) {}
class HitMerkleWitness extends MerkleWitness(8) {}

class BattleshipsZkApp extends SmartContract { 
    @state(Field) player1Id = State<Field>();
    @state(Field) player2Id = State<Field>();
    @state(UInt8) turnCount = State<UInt8>();
    @state(Field) target = State<Field>();
    @state(Field) targetRoot = State<Field>();
    @state(Bool) hitResult = State<Bool>();
    @state(Field) hitRoot = State<Field>();
    @state(Field) serializedHitHistory = State<Field>();

    events = { 
        "Game Hosted: A new Battleships game has been initiated!": Field,
        "Player Joined: A new player has joined the hosted game!": Field,
        "Game Started: The host has played the opening shot!": Field,
        "Turn Wrapped Up: The current player has completed their turn!": Field,
    }

    @method initGame() { 
        super.init();
        
        this.player1Id.set(Field(0));
        this.player2Id.set(Field(0));
        this.turnCount.set(UInt8.from(0));
        this.targetRoot.set(Field(EMPTY_TREE8_ROOT));        
        this.hitRoot.set(EMPTY_TREE8_ROOT);
        this.serializedHitHistory.set(Field(0));
    }

    /**
     * Host a Battleships game by storing the serialized game board and generating a player ID for the host.
     * 
     * @param serializedBoard The serialized game board(ship placements).
     * @param salt A cryptographic salt for player ID generation.
     * @note The terms "host" and "player1" are used interchangeably.
     */
    @method hostGame(serializedBoard: Field, salt: Field) {
        // Fetch the on-chain player1 ID
        const storedHostId = this.player1Id.getAndRequireEquals();
        
        /**
         * Assert that hostID is not updated yet.
         * Ensure nobody tampers with the host ID once updated!
         */ 
        storedHostId.assertEquals(0, "This game already has a host!");

        // Assert that board ship placements are valid
        const boardHash = BoardCircuit.validateBoard(serializedBoard);  

        // Calculate host ID & store it on-chain
        const hostId = Poseidon.hash([boardHash, ...this.sender.toFields(), salt]);
        this.player1Id.set(hostId);

        // Emit event for successfully hosting a Battleships game
        this.emitEvent("Game Hosted: A new Battleships game has been initiated!", hostId);
    }  
    
    /**
     * Join a Battleships game by storing the serialized game board and generating a player ID for the joiner.
     * 
     * @param serializedBoard The serialized game board(ship placements).
     * @param salt A cryptographic salt for player ID generation.
     * @note The terms "joiner" and "player2" are used interchangeably.
     */
    @method joinGame(serializedBoard: Field, salt: Field) { 
        // Fetch the on-chain player2 ID
        const storedJoinerId = this.player2Id.getAndRequireEquals();

        // Assert that no one has already joined the game
        storedJoinerId.assertEquals(0, 'This game is already full!');

        // Assert that joiner ships placement is valid
        const boardHash = BoardCircuit.validateBoard(serializedBoard);  
        
        // Calculate joiner ID & store it on-chain
        const joinerId = Poseidon.hash([boardHash, ...this.sender.toFields(), salt]);
        this.player2Id.set(joinerId);

        // Emit event for successfully joining a Battleships game
        this.emitEvent("Player Joined: A new player has joined the hosted game!", joinerId);
    }

    /**
     * Initiate the first turn of the game by allowing the host player to make the opening shot.
     * 
     * @param serializedTarget - The serialized target for the opening shot.
     * @param serializedBoard - The serialized game board(ship placements).
     * @param salt - A cryptographic salt for player ID generation.
     * @param targetWitness - The witness for the off-chain target Merkle Tree proof.
     * 
     * @notice Proof verification is inherently reactive, and the first target is crucial to kick off the cycle.
     */
    @method firstTurn(
        serializedTarget: Field, 
        serializedBoard: Field, 
        salt: Field, 
        targetWitness: TargetMerkleWitness
    ) {
        // Fetch the on-chain turn counter and assert that it's the first turn
        const turnCount = this.turnCount.getAndRequireEquals();
        turnCount.assertEquals(0, "Opening attack can only be played at the beginning of the game!");

        // Generate the sender's player ID
        const computedPlayerId = BoardUtils.generatePlayerId(serializedBoard, this.sender, salt);

        // Fetch on-chain host ID 
        const storedHostId = this.player1Id.getAndRequireEquals();

        // Restrict access to this method to the game's host
        computedPlayerId.assertEquals(storedHostId, 'Only the host is allowed to play the opening shot!');
        
        // Validate that the target is in the game grid range
        AttackUtils.validateSerializedTarget(serializedTarget);
        
        // Store the target for the adversary to prove on their board in the next turn
        this.target.set(serializedTarget);

        // Assert root index compliance with the the turn counter
        targetWitness.calculateIndex().assertEquals(turnCount.value, "Target storage index is not compliant with the turn counter!");
        
        /** 
         * 1. Check that the target leaf is empty 
         *    --> Prevent updating an already full target leaf
         * 2. Check that the off-chain target storage is in sync
         *    --> A witness of an empty leaf (before update) maintains the same Merkle Tree root
         */ 
        const currentTargetRoot = targetWitness.calculateRoot(Field(0));
        const storedTargetRoot = this.targetRoot.getAndRequireEquals();
        storedTargetRoot.assertEquals(currentTargetRoot, 'Off-chain target Merkle Tree is out of sync!');

        // Calculate the new Merkle root following the updated target root
        const updatedTargetRoot = targetWitness.calculateRoot(serializedTarget);

        // Update the on-chain target Merkle Tree commitment (root)
        this.targetRoot.set(updatedTargetRoot);

        // Increment the turn counter
        this.turnCount.set(turnCount.add(1));

        // Emit event for successfully submitting the opening shot
        this.emitEvent("Game Started: The host has played the opening shot!", storedHostId);
    }

    /**
     * Report the result of the adversary's attack and select a target to retaliate 
     * 
     * @param serializedTarget - The serialized target for the attack.
     * @param serializedBoard - The serialized game board.
     * @param salt - A cryptographic salt for player ID generation.
     * @param targetWitness - The witness for the off-chain target Merkle Tree proof.
     * @param hitWitness - The witness for the off-chain hit Merkle Tree proof.
     * 
     * @notice Once first turn is called, repeatedly calling this function drives game
     *         to completion state. Loser will always be last to call this function and end game.
     */
    @method attack(
        serializedTarget: Field, 
        serializedBoard: Field, 
        salt: Field, 
        targetWitness: TargetMerkleWitness, 
        hitWitness: HitMerkleWitness
    ) { 
        const turnCount = this.turnCount.getAndRequireEquals();
        turnCount.assertGreaterThan(0, "Please wait for the host to play the opening shot first!")
        
        const isHost = turnCount.value.isEven();

        const player1Id = this.player1Id.getAndRequireEquals();
        const player2Id = this.player2Id.getAndRequireEquals();

        const currentPlayerId = Provable.if(
            isHost, 
            player1Id,
            player2Id,
        );
        
        // Deserialize the current player's board
        const deserializedBoard = BoardUtils.deserialize(serializedBoard);

        // Assert that the current eligible player should be the sender
        const senderBoardHash = BoardUtils.hash(deserializedBoard);
        const computedPlayerId = Poseidon.hash([senderBoardHash, ...this.sender.toFields(), salt]);
        computedPlayerId.assertEquals(currentPlayerId, "Invalid Action: either your Player ID is not compliant or it's not your turn yet!");

        // Fetch the on-chain serialized hit history wrapper
        const serializedHitHistory = this.serializedHitHistory.getAndRequireEquals();

        // Deserialize and retrieve players' hit count as well as targets(encoded) that landed a successful hit before
        const [
            [player1HitCount, player2HitCount], 
            [player1HitTargets, player2HitTargets],
        ] = AttackUtils.deserializeHitHistory(serializedHitHistory);

        // Check if there is a winner
        const isOver = player2HitCount.equals(17).or(player1HitCount.equals(17));
        
        // Block game progress if there is a winner
        isOver.assertFalse(`Game is already over!`);    

        // Assert leaf index compliance with the turn counter
        const targetWitnessIndex = targetWitness.calculateIndex(); 
        targetWitnessIndex.assertEquals(turnCount.value, "Target storage index is not compliant with the turn counter!");
        
        // Assert hit witness index is in sync with the target Merkle Tree
        const hitWitnessIndex = hitWitness.calculateIndex();
        hitWitnessIndex.assertEquals(targetWitnessIndex.sub(1), "Hit storage index is not in sync with the target Merkle Tree");

        // Verify the target Merkle root integrity
        const currentTargetRoot = targetWitness.calculateRoot(Field(0));
        const storedTargetRoot = this.targetRoot.getAndRequireEquals();
        storedTargetRoot.assertEquals(currentTargetRoot, 'Off-chain target Merkle Tree is out of sync!');
        
        // Verify the hit Merkle root integrity 
        const currentHitRoot = hitWitness.calculateRoot(Field(0));
        const storedHitRoot = this.hitRoot.getAndRequireEquals();
        storedHitRoot.assertEquals(currentHitRoot, 'Off-chain hit Merkle Tree is out of sync!');

        /**
         * 1. Fetch adversary's serialized target from the previous turn.
         * 2. Deserialize the target.
         * 3. Validate the target and return the hit result.
         */ 
        const adversarySerializedTarget = this.target.getAndRequireEquals();
        const adversaryTarget = AttackUtils.deserializeTarget(adversarySerializedTarget);
        const adversaryHitResult = AttackCircuit.attack(deserializedBoard, adversaryTarget);
        
        // Update the on-chain hit result
        this.hitResult.set(adversaryHitResult);

        // Update the hit Merkle Tree root
        const updatedHitRoot = hitWitness.calculateRoot(adversaryHitResult.toField());
        this.hitRoot.set(updatedHitRoot);
        
        // Update the adversary's hit count & serialize
        const updatedSerializedHitCountHistory = Provable.if(
            isHost, 
            AttackUtils.serializeHitCountHistory([player1HitCount, player2HitCount.add(adversaryHitResult.toField())]),
            AttackUtils.serializeHitCountHistory([player1HitCount.add(adversaryHitResult.toField()), player2HitCount]),
        );
        
        // Deserialize the current player's target
        const playerTarget = AttackUtils.deserializeTarget(serializedTarget);

        // Validate that the player's target falls within battleships grid range
        AttackUtils.validateTarget(playerTarget);

        // Check that player's target is not a target that landed a successful hit before
        const isNullified = Provable.if(
            isHost,
            AttackUtils.validateHitTargetUniqueness(playerTarget, player1HitTargets),
            AttackUtils.validateHitTargetUniqueness(playerTarget, player2HitTargets),
        );

        isNullified.assertFalse('Invalid Target! Please select a unique target!')
        
        // Update hit target history
        const updatedSerializedHitTargetHistory = Provable.if(
            isHost,
            AttackUtils.serializeHitTargetHistory([player1HitTargets, AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player2HitTargets, player2HitCount)]),
            AttackUtils.serializeHitTargetHistory([AttackUtils.updateHitTargetHistory(adversaryTarget, adversaryHitResult, player1HitTargets, player1HitCount), player2HitTargets]),
        );
        
        // Now that hit count and hit target histories are updated, update the on-chain hit history wrapper
        const updatedSerializedHitHistory = AttackUtils.serializeHitHistory(updatedSerializedHitCountHistory, updatedSerializedHitTargetHistory);
        this.serializedHitHistory.set(updatedSerializedHitHistory);
        
        // Update the on-chain serialized target
        this.target.set(serializedTarget);

        // Calculate target Merkle Tree root
        const updatedTargetRoot = targetWitness.calculateRoot(serializedTarget);

        // Update the on-chain target Merkle Tree root
        this.targetRoot.set(updatedTargetRoot);

        // Increment turn counter
        this.turnCount.set(turnCount.add(1));
        
        // Emit event for successfully submitting a valid attack and reporting the adversary's hit result 
        this.emitEvent("Turn Wrapped Up: The current player has completed their turn!", computedPlayerId);
    }    
}

