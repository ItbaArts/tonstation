const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const { DateTime } = require('luxon');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class TonStation {
    constructor(accountIndex = 0) {
        this.baseURL = 'https://tonstation.app';
        this.headers = {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Origin': 'https://tonstation.app',
            'Referer': 'https://tonstation.app/app/',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
            'Sec-Ch-Ua-Mobile': '?1',
            'Sec-Ch-Ua-Platform': '"Android"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        };
        this.skipTaskIds = ["66dad41d9b1e65019ad30629", "66f560c1c6fc8ba931b33420"];
        this.proxies = fs.readFileSync('proxy.txt', 'utf8').split('\n').filter(Boolean);
        this.accountIndex = accountIndex;
        this.proxyIP = null;
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const accountPrefix = `[Account ${this.accountIndex + 1}]`;
        const ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : '[Unknown IP]';
        let logMessage = '';
        
        switch(type) {
            case 'success':
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
                break;
            case 'error':
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
                break;
            case 'warning':
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
                break;
            default:
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
        }
        
        console.log(`[${timestamp}] ${logMessage}`);
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', { httpsAgent: proxyAgent });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error checking proxy IP: ${error.message}`);
        }
    }

    async makeRequest(method, url, data = null, token = null, proxyAgent) {
        const headers = { ...this.headers };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            method,
            url,
            headers,
            httpsAgent: proxyAgent
        };

        if (data) {
            config.data = data;
        }

        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            this.log(`Request error: ${error.message}`, 'error');
            return null;
        }
    }

    async authenticate(initData, proxyAgent) {
        const url = `${this.baseURL}/userprofile/api/v1/users/auth`;
        const payload = { initData };

        try {
            const response = await this.makeRequest('POST', url, payload, null, proxyAgent);
            if (response) {
                return response;
            } else {
                throw new Error(`Authentication failed`);
            }
        } catch (error) {
            this.log(`Authentication error: ${error.message}`, 'error');
            return null;
        }
    }

    async getFarmStatus(token, userId, proxyAgent) {
        const url = `${this.baseURL}/farming/api/v1/farming/${userId}/running`;
        try {
            const response = await this.makeRequest('GET', url, null, token, proxyAgent);
            if (response) {
                return response.data;
            } else {
                this.log(`Get farming status failed!`, 'error');
            }
        } catch (error) {
            this.log(`Get farming status failed: ${error.message}`, 'error');
        }
    }

    async startFarm(token, userId, proxyAgent) {
        const url = `${this.baseURL}/farming/api/v1/farming/start`;
        const payload = {
            "userId": userId.toString(),
            "taskId": "1"
        }
        try {
            const response = await this.makeRequest('POST', url, payload, token, proxyAgent);
            if (response) {
                const timeEnd = DateTime.fromISO(response.data.timeEnd);
                this.log(`Farm started successfully, ends at ${timeEnd.toLocaleString(DateTime.DATETIME_FULL)}`, 'success');
            } else {
                this.log(`Failed to start farm!`, 'error');
            }
        } catch (error) {
            this.log(`Failed to start farm: ${error.message}`, 'error');
        }
    }

    async claimFarm(token, userId, farmId, proxyAgent) {
        const url = `${this.baseURL}/farming/api/v1/farming/claim`;
        const payload = {
            "userId": userId.toString(),
            "taskId": farmId
        }
        try {
            const response = await this.makeRequest('POST', url, payload, token, proxyAgent);
            if (response) {
                this.log(`Farm claimed successfully, received ${response.data.amount}`, 'success');
            } else {
                this.log(`Failed to claim farm!`, 'error');
            }
        } catch (error) {
            this.log(`Failed to claim farm: ${error.message}`, 'error');
        }
    }

    async getTask(token, userId, proxyAgent) {
        const url = `${this.baseURL}/quests/api/v1/quests?userId=${userId}`;
        try {
            const response = await this.makeRequest('GET', url, null, token, proxyAgent);
            if (response) {
                return response.data;
            } else {
                this.log(`Failed to get task list!`, 'error');
            }
        } catch (error) {
            this.log(`Failed to get task list: ${error.message}`, 'error');
        }
    }

    async startTask(token, userId, task, proxyAgent) {
        const url = `${this.baseURL}/quests/api/v1/start`;
        const payload = {
            "userId": userId.toString(),
            "questId": task.id,
            "project": task.project
        }
        try {
            await this.makeRequest('POST', url, payload, token, proxyAgent);
        } catch (error) {
            this.log(`Failed to start task ${task.description}: ${error.message}`, 'error');
        }
    }

    async claimTask(token, userId, task, proxyAgent) {
        const url = `${this.baseURL}/quests/api/v1/claim`;
        const payload = {
            "userId": userId.toString(),
            "questId": task.id,
            "project": task.project
        }
        try {
            const response = await this.makeRequest('POST', url, payload, token, proxyAgent);
            if (response) {
                this.log(`Task ${task.description} completed successfully | Reward ${task.reward.amount} SOON`, 'success');
            } else {
                this.log(`Failed to complete task ${task.description}!`, 'error');
            }
        } catch (error) {
            this.log(`Failed to complete task ${task.description}: ${error.message}`, 'error');
        }
    }

    async processAccount(initData) {
        const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
        const userId = userData.id;
        const firstName = userData.first_name;
        const proxy = this.proxies[this.accountIndex % this.proxies.length];
        const proxyAgent = new HttpsProxyAgent(proxy);

        try {
            this.proxyIP = await this.checkProxyIP(proxy);
        } catch (error) {
            this.log(`Unable to check proxy IP: ${error.message}`, 'warning');
            return;
        }

        this.log(`Starting process for ${firstName}`, 'info');
        
        const authResult = await this.authenticate(initData, proxyAgent);
        if (authResult) {
            this.log('Login successful!', 'success');
            const { accessToken } = authResult;

            await this.handleFarming(accessToken, userId, proxyAgent);
            await this.handleTasks(accessToken, userId, proxyAgent);
        } else {
            this.log(`Login failed for account ${userId}`, 'error');
        }
    }

    async handleFarming(accessToken, userId, proxyAgent) {
        const farmStatus = await this.getFarmStatus(accessToken, userId, proxyAgent);
        if (farmStatus && farmStatus.length > 0) {
            const currentFarm = farmStatus[0];
            const timeEnd = DateTime.fromISO(currentFarm.timeEnd);
            this.log(`Farm completion time ${timeEnd.toLocaleString(DateTime.DATETIME_FULL)}`, 'info');

            if (DateTime.now() > timeEnd) {
                await this.claimFarm(accessToken, userId, currentFarm._id, proxyAgent);
                await this.startFarm(accessToken, userId, proxyAgent);
            } else {
                this.log(`Time remaining ${timeEnd.diffNow().toFormat("hh'h' mm'm' ss's'")}.`, 'info');
            }
        } else {
            this.log("Starting farm...", 'info');
            await this.startFarm(accessToken, userId, proxyAgent);
        }
    }

    async handleTasks(accessToken, userId, proxyAgent) {
        const tasks = await this.getTask(accessToken, userId, proxyAgent);
        if (tasks) {
            for (const task of tasks) {
                if (this.skipTaskIds.includes(task.id)) {
                    continue;
                }
                await this.startTask(accessToken, userId, task, proxyAgent);
                await this.claimTask(accessToken, userId, task, proxyAgent);
            }
        }
    }
}

if (isMainThread) {
    async function main() {
        const dataFile = path.join(__dirname, 'query.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        const maxThreads = 10;
        const chunkSize = Math.ceil(data.length / maxThreads);
        const chunks = Array.from({ length: maxThreads }, (_, i) =>
            data.slice(i * chunkSize, (i + 1) * chunkSize)
        );

        while (true) {
            const workers = chunks.map((chunk, index) =>
                new Promise((resolve, reject) => {
                    const worker = new Worker(__filename, {
                        workerData: { chunk, startIndex: index * chunkSize }
                    });
                    worker.on('message', resolve);
                    worker.on('error', reject);
                    worker.on('exit', (code) => {
                        if (code !== 0)
                            reject(new Error(`Worker stopped with exit code ${code}`));
                    });

                    setTimeout(() => {
                        worker.terminate();
                        reject(new Error('Worker timed out after 10 minutes'));
                    }, 10 * 60 * 1000);
                })
            );

            try {
                await Promise.all(workers);
            } catch (error) {
                console.error('Error in worker:', error);
            }

            console.log('Resting for 8 hours before starting new loop...');
            await new Promise(resolve => setTimeout(resolve, 28800 * 1000));
        }
    }

    main().catch(console.error);
} else {
    (async () => {
        const { chunk, startIndex } = workerData;
        for (let i = 0; i < chunk.length; i++) {
            const client = new TonStation(startIndex + i);
            await client.processAccount(chunk[i]);
        }
        parentPort.postMessage('done');
    })();
}