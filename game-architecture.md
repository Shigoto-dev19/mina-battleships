# Game Architecture Considerations

- Most of the game architecture considerations are a workaround to accommodate the Battleships game state within the confines of the allowed 8 field elements on-chain.

## Board

- Serialize board
- Hash board

## Player

### Player ID

- Initially the player was set as a struct(object) that contains:
    1. Player address(2 field elements)
    2. Player's board hash(1 field element)
- The player's address could be hash to fit one field but that's still not efficient due to the variety of game state storage variables.
- Such data structure makes it easy to exceed more than 8 pieces of state.
- Basically, we want to identify the player from his address `this.sender`.
- We also want to verify his board integrity when his scan his/her adversary's attack.
- **SOLUTION**: Combine both required arguments by hashing `[playerAddress,  board]`
    ==> The result is an argument called `playerId`.

### Game Host (player1)

- At the beginning the `hostGame` method used to accept any player who wants to host a game.
    1. The zkApp validates the board
    2. The zkApp calculates host ID
    3. Store the host ID on-chain
- The logic above is correct but it's missing a check.
    - What if someone calls the method `hostGame`.
        - Then the **hostID** stored on-chain can be updated if a meddler provides a valid board(ships placement).
        - This will mess up completely with the game order as every on-going state will refer to the new host(player1Id).
    - **SOLUTION:** 
        - Initialize `playerID` as `Field(0)`.
        - The `hostGame` now only updates the `hostID` if the initial ID stored on-chain is `Field(0)`.
        - This makes `hostGame` method callable only once.
        - This prevents other players to tamper with `hostID` of an ongoing game.


### Game Joiner (player2)

- For tracking whether the game is full or not, the battleships game state used to have a `Bool` variable called `joinable` that determines
whether a game is joinable or not. 
- This is unnecessary as game fullness can be traceable following if player1 & player2 IDs are already updated or not.
- The `joinable` variable used to prevent other players from tampering with the current joiner's ID stored on-chain.
    - Now similar to `hostGame` method
        1. before update, the `player2Id` is asserted to be `Field(0)`
        2. validate joiner board
        3. calculate joiner ID
        4. update on-chain player2Id(joiner)

## Attack

- Serialize attack target to fit one field state.
- Validate ships integrity check outside of the attack circuit
- Store hit history of a sequence of bits.
    - This is quite adequate regarding that a hit result is binary (1 if hit & 0 if missed).

### First Turn 

- The `firstTurn` method doesn't return an attack result or even use the player's board.
    - **NOTE:** The first method takes the player's board as an argument but that's only to generate and verify player's ID.
- Following the attack principle of the game:
    1. player should fetch his adversary's target on-chain
    2. scan it through his/her board off-chain
    3. store the adversary's hit result on-chain
- The game principle preserves players' board privacy but causes a delay of one turn to report the hit result to the adversary.
- Because this delay is inevitable, the first player(host) should only select his target and store it on-chain to initiate the alternative attack sequence.
- We added a Merkle Tree commitment for the target storage which verifies that the players are are storing the target history consistently with the zkApp.
- For the `firstTurn` method, it is not crucial to add the **TargetMerkleWitness** argument but this architecture decision helps keeping the initialized target root up to date. Otherwise, the zkApp would expect `attack` method to have a target merkle root that is initialized with `firstTurn` Target.
    - This would add more requirements from the players' side later on to provide the expected root.
    
- The `firstTurn` method works as follows: 
    1. Assert that the game didn't start yet(this.turns === 0).
    2. Restrict access to the host(generate ID and verify).
    3. Validate that the host's target is in game map range.
        - NOTE: The attack method validates the target but having an invalid target at the first turn will require the host to replay the **first turn** which can mess up with the order of the game!
    4. Storage player's target on-chain.
    5. Increment turn counter.

### Attack(turn)
- Calling this method, a player will initiate the following changes: 
    - The player(caller) returns attack result of his adversary from the previous turn.
        1. fetch adversary's target stored on-chain
        2. scan it through his/her board
        3. return true for hit and false for miss
    - The caller selects a target and store it on-chain.

- Ofcourse, there are many checks to validate and maintain the game's order and security.
    - The game is interactive, for that the zkApp restricts calling the method to what the current eligible player.
        - Regarding that the host(player1) always starts the game and that the turn counter is initially set as 0.
        - If turns **isEven** then the current eligible player is the host(player1).
        - If turns **isOdd** then the current eligible player is the joiner(player2).
    
    - The game state data must be stored off-chain for the players to keep track of a **correct** & **consistent** record of the game.
        - The zkApp asserts consistency of a merkle tree to store both player's target which is completely synchronous with the game turn counter.
            - This verifies the following:
                - Asserting witness index to be equal with the turn counter verifies **order** consistency of target storage.
                - Asserting that a computed zero of Field(0) verifies two things.
                    - It proves that the leaf is empty and is spare for a new target to be stored.
                    - It proves that the target merkle tree is not compromised and in sync with the on-chain storage.
        - The zkApp asserts consistency of a merkle tree to store both player's target which is one turn(index) behind the turn counter because the caller will store the hit result from the previous turn.
            - Similar to the target merkle tree, the checks above are also applied to the hit merkle Tree except that the index is asserted to be one turn behind the index of the target.
                - This binds both merkle trees together.
                - Assert the storage order which is important in the case of this game because the client-side code will print state according to the parity of storage index :)
- After validating method inputs the player: 
    - Deserialize target.
    - Validate target and return hit result.
    - Update game state related to the hit result:
        - Store hit result on-chain
        - Compute the new hit merkle tree and update the value on-chain.
        - Update **hitHistory** 
            - Fetch the serialized hit history.
            - Deserialize hit history
            - Update adversary's hit counter
            - Serialize the updated hit story
            - Update the value stored on-chain
    - Check if there is a winner by checking if the adversary's hit count reached 17 or not.
    - Validate the caller's target and store it on-chain.
    - Increment turn counter.


- TODO: Add notes about the relevence of method check order


    
## Feedback

- I realized that verifying code with `Provable.runAndCheck()` does not validate code provability.
    - This makes sense regarding that the method runs provable code without creating a proof.
    - Better check with `proofsEnable=true` when running zkapp on a local blockchain.
- Depending on the size of the variable, the developer can bundle a set of small-size state and store it as a single field on-chain.
    - This technique evidently saves storage on-chain with the tradeoff of adding computation(deserialization) when generating the proof.
    - This can be helpful especially when developing a game due to the need of multiple state variables.
- I think it would be good to add a variable in o1js that fetches state from the zkapp --> This would help reduce variable calls to fetch on-chain data.
    ````typescript
     let state-on-chain = zkapp.state.get(); 
     let { state1, stat2, state3 } = state-on-chain;
    ````
