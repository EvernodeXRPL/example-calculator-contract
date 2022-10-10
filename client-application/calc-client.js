const fs = require('fs');
const readline = require('readline');
const HotPocket = require('hotpocket-js-client');

async function clientApp() {

    const keyFile = 'user.key';

    // Re-generate a user key pair for the client.
    if (process.argv[2] == 'generatekeys' || !fs.existsSync(keyFile)) {
        const newKeyPair = await HotPocket.generateKeys();
        const saveData = Buffer.from(newKeyPair.privateKey).toString('hex');
        fs.writeFileSync(keyFile, saveData);
        console.log('New key pair generated.');

        if (process.argv[2] == 'generatekeys') {
            const pkhex = Buffer.from(newKeyPair.publicKey).toString('hex');
            console.log('My public key is: ' + pkhex);
            return;
        }
    }

    // Generate the key pair using saved private key data.
    const savedPrivateKeyHex = fs.readFileSync(keyFile).toString();
    const userKeyPair = await HotPocket.generateKeys(savedPrivateKeyHex);

    const pkhex = Buffer.from(userKeyPair.publicKey).toString('hex');
    console.log('My public key is: ' + pkhex);

    // Simple connection to single server without any validations.
    const ip = process.argv[2] || 'localhost';
    const port = process.argv[3] || '8081';
    const client = await HotPocket.createClient(
        ['wss://' + ip + ':' + port],
        userKeyPair
    );

    client.on(HotPocket.events.disconnect, () => {
        console.log('Disconnected');
        rl.close();
    })

    // This will get fired as servers connects/disconnects.
    client.on(HotPocket.events.connectionChange, (server, action) => {
        console.log(server + " " + action);
    })

    // This will get fired when contract sends outputs.
    client.on(HotPocket.events.contractOutput, (r) => {
        r.outputs.forEach(o => {
            if (o?.type == 'data_result') {
                console.log('\x1b[32m%s\x1b[0m', `Output >> ${o.data}`);
            } else if (o?.type == 'error') {
                console.log('\x1b[31m%s\x1b[0m', `Error >> ${o.error}`);
            }
        });
    })


    // Establish HotPocket connection.
    if (!await client.connect()) {
        console.log('Connection failed.');
        return;
    }

    console.log('HotPocket Connected.');

    // start listening for stdin
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // On ctrl + c we should close HP connection gracefully.
    rl.on('SIGINT', () => {
        console.log('SIGINT received...');
        rl.close();
        client.close();
    });

    console.log("Ready to accept inputs.");
    console.log('\x1b[32m%s\x1b[0m', "Run 'help' for more information on commands.");


    const input_pump = () => {
        rl.question('', async (inp) => {

            if (inp.length > 0) {
                const command = {};
                const expression = {};
                const argv = ((inp.trim()).replace(/  +/g, ' ')).split(' ');
                const length = argv.length;
                command.type = argv.shift().toUpperCase();

                if (length > 0) {

                    // Computation commands should bind with its expression.
                    if (['ADD', 'SUB', 'MUL', 'DIV', 'POW', 'RAN'].includes(command.type)) {
                        expression.operator = command.type;
                        command.type = 'COMP';

                        expression.operand1 = parseFloat(argv[0]);
                        expression.operand2 = parseFloat(argv[1]);
                        command.expression = expression;
                    }

                    if (command.type == 'REPLAY') {
                        const res = await client.submitContractReadRequest(JSON.stringify(command));
                        if (res?.type == 'data_result') {
                            console.log('\x1b[32m%s\x1b[0m', `Output >> ${res.data}`);
                        } else if (res?.type == 'error') {
                            console.log('\x1b[31m%s\x1b[0m', `Error >> ${res.error}`);
                        }
                    } else if (command.type == 'HELP') {
                        console.log('\x1b[36m%s\x1b[0m',
                            `--- Commands ---
    Computation commands.

        ADD <operand 1> <operand 2> -- Adds <operand 1> and <operand 2>.
        SUB <operand 1> <operand 2> -- Subtracts <operand 2> from <operand 1>.
        MUL <operand 1> <operand 2> -- Multiplies <operand 1> and <operand 2>.
        DIV <operand 1> <operand 2> -- Divided <operand 1> from <operand 2>.
        POW <operand 1> <operand 2> -- Provides <operand 2> th power of <operand 1>.
        RAN <operand 1> <operand 2> -- Provides random number between <operand 1> and <operand 2>.

    Calculator commands.

        REPLAY                      -- Replays last executed computation.
        CLR                         -- Clears calculator memory for this user session.
                        `);
                    } else {
                        await client.submitContractInput(JSON.stringify(command));
                    }
                }
            }
            input_pump();
        })
    }
    input_pump();
}

clientApp();