const HotPocket = require('hotpocket-nodejs-contract');
const fs = require('fs').promises;

class Calculator {

    commands = ['COMP', 'CLR', 'REPLAY'];
    #banner = '';
    #computation = null

    // Wired functions.
    sendOutput;
    getContractConfigs;
    sendViaNPL;

    /**
     * Stores the banner of an executed computation.
     * @param {string} filename Name of the file to be written.
     * @returns An object with relevant content.
     */
    async store(filename) {
        try {
            await fs.writeFile(filename, this.#banner);
            return { type: 'data_result', data: this.#banner };
        } catch (err) {
            console.log(err);
            return { type: 'error', error: 'Error occurred while recording.' };
        }
    }

    /**
     * Replays last executed computation.
     * @param {string} filename Name of the file to be read for replay.
     * @returns An object with relevant content.
     */
    async replay(filename) {
        try {
            const output = (await fs.readFile(filename)).toString();
            return { type: 'data_result', data: output };
        }
        catch (err) {
            console.log(err);
            return { type: 'error', error: 'Nothing was found to REPLAY.' };
        }
    }

    /**
     * Clears the last executed computation in Calculator Memory.
     * @param {string} filename Name of the file to be removed from the memory
     */
    async clear(filename) {
        fs.unlink(filename, (err) => {
            if (err) {
                console.log(err);
                return { type: 'error', error: 'Error occurred clearing calculator memory.' }
            }
        })
    }

    /**
     * Generates a random number for the provided range.
     * @param {number} min Minimum value of the range.
     * @param {number} max Maximum value of the range.
     * @returns A random number within the range.
     */
    async generateRndNo(min, max) {
        const hpUNL = this.getUNL();
        const unlSize = hpUNL.count();
        const hpconfig = await this.getHPConfigs();

        // Wait only for half of roundtime.
        const timeoutMs = Math.ceil(hpconfig.consensus.roundtime / 2);

        let completed = false;

        // Start listening to incoming NPL messages before we send ours.
        const promise = new Promise((resolve, reject) => {
            let receivedNos = [];

            function getMax() {
                console.log(`Received Numbers :`, receivedNos);
                let max = 0;
                for (const randomNumber of receivedNos) {
                    if (randomNumber > max) {
                        max = randomNumber;
                    }
                }
                return max;
            }

            let timer = setTimeout(() => {
                clearTimeout(timer);
                completed = true;
                // If we've received less than what we expect, throw error.
                if (receivedNos.length < unlSize)
                    reject('Error generating the random number.');
                else
                    resolve(getMax());
            }, timeoutMs)

            hpUNL.onMessage((node, msg) => {
                if (!completed) {
                    const obj = JSON.parse(msg.toString());
                    if (obj.key === "randomNumber") {
                        const number = Number(obj.value);
                        receivedNos.push(number);
                    }
                    if (receivedNos.length === unlSize) {
                        clearTimeout(timer);
                        completed = true;
                        resolve(getMax());
                    }
                }
            });

        });

        const random = Math.floor(Math.random() * (max - min + 1)) + min;
        await this.sendViaNPL(JSON.stringify({ key: "randomNumber", value: random }));

        return await promise;
    }

    /**
     * Computes the provided arithmetic operation.
     * @param {object} expression The arithmetic operation with operator and operands.
     * @param {string} filename Relevant memory file name.
     * @returns A string which contains the output of the computation.
     */
    async compute(expression, filename) {
        const operand1 = parseFloat(expression?.operand1);
        const operand2 = parseFloat(expression?.operand2);

        switch (expression?.operator) {
            case "ADD":
                this.#computation = operand1 + operand2;
                this.#banner = `${operand1} + ${operand2} = ${this.#computation}`;
                break;

            case "SUB":
                this.#computation = operand1 - operand2;
                this.#banner = `${operand1} - ${operand2} = ${this.#computation}`;
                break;

            case "MUL":
                this.#computation = operand1 * operand2;
                this.#banner = `${operand1} * ${operand2} = ${this.#computation}`;
                break;

            case "DIV":
                this.#computation = operand1 / operand2;
                this.#banner = `${operand1} / ${operand2} = ${this.#computation}`;
                break;

            case "POW":
                this.#computation = Math.pow(operand1, operand2);
                this.#banner = `${operand1} to the power of ${operand2} = ${this.#computation}`;
                break;

            case "RAN":
                this.#computation = await this.generateRndNo(operand1, operand2);
                this.#banner = `Random Number = ${this.#computation}`;
                break;

            default:
                break;
        }

        return await this.store(filename);
    }


    /**
     * Handles incoming calculator command calls.
     * @param {object} user The user/client related to the command execution.
     * @param {object} command The executed command.
     * @param {boolean} isReadOnly Whether this is contract invocation or not.
     */
    async handleCommand(user, command, isReadOnly) {

        const filename = `${user.publicKey}.log`;
        let response = null;

        if (isReadOnly && command.type != 'REPLAY') {
            await this.sendOutput(user, {
                type: 'error',
                error: this.commands.includes(command.type) ? 'Command is not supported in read-only mode.' : 'Invalid input provided.'
            });
        } else if (command.type == 'REPLAY') {
            response = await this.replay(filename);
            await this.sendOutput(user, response);

        } else if (command.type == 'COMP') {
            response = await this.compute(command.expression, filename);
            await this.sendOutput(user, response);
        }
        else if (command.type == 'CLR') {
            response = await this.clear(filename);
            await this.sendOutput(user, response);
        }
        else {
            await this.sendOutput(user, {
                type: 'error',
                error: 'Invalid input provided.'
            })
        }
    }
}


/**
 * HotPocket smart contract is defined as a function which takes the HotPocket contract context as an argument.
 * This function gets invoked every consensus round and whenever a user sends a out-of-consensus read-request.
 */
async function contract(ctx) {

    // Create our application logic component.
    // This pattern allows us to test the application logic independently of HotPocket.
    const calculator = new Calculator();

    // Wire-up output emissions from the calculator application before we pass user inputs to it.
    calculator.sendOutput = async (user, output) => {
        await user.send(output)
    }

    // Wire-up HotPocket configuration info acquisitions.
    calculator.getHPConfigs = async () => {
        return await ctx.getConfig();
    }

    // Wire-up HotPocket UNL acquisitions.
    calculator.getUNL = () => {
        return ctx.unl;
    }

    // Wire-up HotPocket NPL channel usage.
    calculator.sendViaNPL = async (message) => {
        await ctx.unl.send(message);
    }

    // In 'readonly' mode, nothing our contract does will get persisted on the ledger. The benefit is
    // readonly messages gets processed much faster due to not being subjected to consensus.
    // We should only use readonly mode for returning/replying data for the requesting user.
    //
    // In consensus mode (NOT read-only), we can do anything like persisting to data storage and/or
    // sending data to any connected user at the time. Everything will get subjected to consensus so
    // there is a time-penalty.
    const isReadOnly = ctx.readonly;

    // Process user inputs.
    // Loop through list of users who have sent us inputs.
    for (const user of ctx.users.list()) {

        // Loop through inputs sent by each user.
        for (const input of user.inputs) {

            // Read the data buffer sent by user (this can be any kind of data like string, json or binary data).
            const buf = await ctx.users.read(input);

            // Let's assume all data buffers for this contract are JSON.
            // In real-world apps, we need to gracefully filter out invalid data formats for our contract.
            const command = JSON.parse(buf);

            // Pass the JSON message to our application logic component.
            await calculator.handleCommand(user, command, isReadOnly);
        }
    }
}

const hpc = new HotPocket.Contract();
hpc.init(contract);