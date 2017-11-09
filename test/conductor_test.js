const should = require('should');
const cluster = require('cluster');

if (!cluster.isMaster) {
    // WORKER TESTS (spawned by master)
    require('./conductor_worker_test');
} else {


    if (process.env.running_under_istanbul) {
        // use coverage for forked process
        // disabled reporting and output for child process
        // enable pid in child process coverage filename
        cluster.setupMaster({
            exec: './node_modules/.bin/istanbul',
            args: [
                'cover',  '--print', 'none',  '--include-pid',
                process.argv[1], '--'].concat(process.argv.slice(2))
        });
    }

    // MASTER TESTS (main process)
    describe('Conductor', () => {

        const Conductor = require('../Conductor');

        it('accepts options', () => {
            const master = new Conductor({
                workerLimit: 2,
                jobsQueue: [1,2,3,4,5],
                logging: false,
                lookups: { poop: new Map() }
            });

            master.workerLimit.should.be.exactly(2);
            master.jobsQueue.should.deepEqual([1,2,3,4,5]);
            master.logging.should.be.exactly(false);
            master.lookups.should.have.key('poop');

            master.error('this text will not show up with logging off');
        });

        it('handles lookups', () => {

            const poop = new Map();
            poop.set('size', 1);
            poop.set('smell', 'pungent');

            const objectMap = {
                key: 'value'
            };

            const master = new Conductor({
                lookups: { poop, objectMap }
            });

            master.getLookup('poop').should.be.exactly(poop);
            master.getLookup('objectMap').should.be.exactly(objectMap);

            master.getLookupValue('poop', 'size').should.be.exactly(1);
            master.getLookupValue('poop', 'smell').should.be.exactly('pungent');
            should(master.getLookupValue('poop', 'girth')).be.exactly(undefined);

            master.getLookupValue('objectMap', 'key').should.be.exactly('value');
            should(master.getLookupValue('objectMap', 'girth')).be.exactly(undefined);

            should(master.getLookupValue('nope', 'nope')).be.exactly(undefined);

            master.setLookupValue('poop', 'girth', 42);
            master.setLookupValue('objectMap', 'girth', 42);

            master.getLookupValue('poop', 'girth').should.be.exactly(42);
            master.getLookupValue('objectMap', 'girth').should.be.exactly(42);

        });

        it('should basically work', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'basic' };
            master.lookups.poop = new Map();
            master.logging = false;

            master.on('end', () => {
                done();
            });

            master.on('error', (err) => {
                throw err;
            });

            // Generate 20 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.isProcessing().should.be.exactly(false);

            master.start();

            master.isProcessing().should.be.exactly(true);

        });

        it('should handle error cases', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'errors' };
            master.lookups.poop = new Map();
            master.logging = true;

            master.on('end', () => {
                errors.should.be.exactly(1);
                done();
            });

            let errors = 0;
            master.on('error', (err) => {
                should(err.type).be.exactly('worker_crash');
                should(err.workerId).be.a.Number();
                should(err.code).be.exactly(4); // worker.crash()
                should(err.signal).be.exactly(null);
                errors++;
            });

            // Generate 10 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.start();

        });

        it('should handle custom messaging', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'messages' };
            master.lookups.poop = new Map();
            master.logging = false;

            master.on('end', () => {
                errors.should.be.exactly(2);
                done();
            });

            master.onWorkerMessage = function(id, msg) {

                if (msg.cmd) {
                    switch(msg.cmd) {
                        case "good":
                            should(msg.data.key).be.exactly('val');
                            this.sendMessageToWorker(id, "good", { poop: "Yes" }, msg.callback);
                            return;

                        case "bogus":
                            this.sendMessageToWorker(id, "bogus", msg, "bogus_Callback");
                            return;

                        case "kaboom":
                            console.log('time to explode');
                            cluster.workers[id].send({
                                bogus: true
                            });
                            console.log('exploded');
                            return;
                    }

                } else {
                    if (msg.callback) this.sendMessageToWorker(id, msg.cmd || "error", { error: "Unhandled command in custom handler!" }, msg.callback);
                }
            };


            let errors = 0;
            master.on('error', (err) => {
                should(err.type).be.exactly('worker_crash');
                should(err.workerId).be.a.Number();
                should(err.code).be.exactly(4); // worker.crash()
                should(err.signal).be.exactly(null);
                errors++;
            });

            // Generate 10 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.start();

        });

        it('should report stats properly', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'stats' };
            master.lookups.poop = new Map();
            master.logging = false;

            let statsReceived = 0;

            master.on('end', () => {
                statsReceived.should.be.exactly(2);
                done();
            });

            master.on('error', (err) => { throw err });
            master.on('stats', (data) => {

                data.raw.should.be.an.Object();
                const keys = Object.keys(data.raw);
                // console.log(keys);
                // console.log(require('util').inspect(data, { colors: true, depth: 10}));

                keys.should.have.length(2);
                data.avgTimeSpan.should.be.a.Number();
                data.agg.should.be.an.Object();


                if (statsReceived === 0) {
                    // Should get a round on interval

                    data.raw[keys[0]].timeSpan.should.be.a.Number();
                    data.raw[keys[1]].timeSpan.should.be.a.Number();

                    data.raw[keys[0]].diff.should.be.an.Object();
                    data.raw[keys[1]].diff.should.be.an.Object();

                    data.raw[keys[0]].last.should.be.an.Object();
                    data.raw[keys[1]].last.should.be.an.Object();

                    data.raw[keys[0]].diff.jobsDone.should.be.greaterThanOrEqual(0);
                    data.raw[keys[1]].diff.jobsDone.should.be.greaterThanOrEqual(0);

                    data.raw[keys[0]].last.jobsDone.should.be.greaterThanOrEqual(0);
                    data.raw[keys[1]].last.jobsDone.should.be.greaterThanOrEqual(0);

                    const totalDoneDiff1 = data.raw[keys[0]].diff.jobsDone + data.raw[keys[1]].diff.jobsDone;
                    totalDoneDiff1.should.be.exactly(5);

                    const totalDoneLast1 = data.raw[keys[0]].last.jobsDone + data.raw[keys[1]].last.jobsDone;
                    totalDoneLast1.should.be.exactly(5);

                    const totalCustomLast1 = data.raw[keys[0]].last.customMetric + data.raw[keys[1]].last.customMetric;
                    totalCustomLast1.should.be.exactly(2);

                    const totalCustomDiff1 = data.raw[keys[0]].diff.customMetric + data.raw[keys[1]].diff.customMetric;
                    totalCustomDiff1.should.be.exactly(2);

                    data.agg.diff.jobsDone.should.be.exactly(5);
                    data.agg.last.jobsDone.should.be.exactly(5);

                } else if (statsReceived === 1) {
                    // Should get a round on end

                    data.raw[keys[0]].timeSpan.should.be.a.Number();
                    data.raw[keys[1]].timeSpan.should.be.a.Number();

                    data.raw[keys[0]].diff.should.be.an.Object();
                    data.raw[keys[1]].diff.should.be.an.Object();

                    data.raw[keys[0]].last.should.be.an.Object();
                    data.raw[keys[1]].last.should.be.an.Object();

                    data.raw[keys[0]].diff.jobsDone.should.be.greaterThan(0);
                    data.raw[keys[1]].last.jobsDone.should.be.greaterThan(0);

                    data.raw[keys[0]].diff.jobsDone.should.be.greaterThan(0);
                    data.raw[keys[1]].last.jobsDone.should.be.greaterThan(0);

                    data.raw[keys[0]].diff.jobsDone.should.be.lessThanOrEqual(data.raw[keys[0]].last.jobsDone);
                    data.raw[keys[1]].diff.jobsDone.should.be.lessThanOrEqual(data.raw[keys[1]].last.jobsDone);

                    const totalDoneDiff2 = data.raw[keys[0]].diff.jobsDone + data.raw[keys[1]].diff.jobsDone;
                    totalDoneDiff2.should.be.exactly(5);

                    const totalDoneLast2 = data.raw[keys[0]].last.jobsDone + data.raw[keys[1]].last.jobsDone;
                    totalDoneLast2.should.be.exactly(10);

                    const totalCustomLast2 = data.raw[keys[0]].last.customMetric + data.raw[keys[1]].last.customMetric;
                    totalCustomLast2.should.be.exactly(4);

                    const totalCustomDiff2 = data.raw[keys[0]].diff.customMetric + data.raw[keys[1]].diff.customMetric;
                    totalCustomDiff2.should.be.exactly(2);

                    data.agg.diff.jobsDone.should.be.exactly(5);
                    data.agg.last.jobsDone.should.be.exactly(10);
                } else {
                    // Should not get more than 2 reports
                    throw new Error('Should not receive any more than 2 reports here');
                }

                statsReceived++;
            });

            // Generate 10 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.start();
        });

        it('should broadcast messages to all workers', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'broadcast' };
            master.logging = false;

            let callbacks = 0;
            let readies = 0;

            master.on('end', () => {
                callbacks.should.be.exactly(2);
                done();
            });

            master.on('error', (err) => { throw err });

            // Generate 10 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.onWorkerMessage = function(id, msg) {
                if (msg.cmd) {
                    switch(msg.cmd) {
                        case "ready":
                            readies++;
                            if (readies === 2) {
                                master.broadcastMessageToWorkers('hellothere', { whats:'up' });
                            }
                            if (msg.callback) this.sendMessageToWorker(id, "ack", { }, msg.callback);
                            return;
                        case 'got it boss':
                            callbacks++;
                            // if (msg.callback) this.sendMessageToWorker(id, "ack", { }, msg.callback);
                            return;
                    }

                } else {
                    if (msg.callback) this.sendMessageToWorker(id, msg.cmd || "error", { error: "Unhandled command in custom handler!" }, msg.callback);
                }
            };

            master.start();
        });

        it('should abort workers', (done) => {

            const master = new Conductor();

            master.workerLimit = 2; // consistency across machines
            master.workerEnv = { test_type: 'abort' };
            master.logging = false;

            let readies = 0;

            master.on('end', () => {
                master.jobsQueue.length.should.be.exactly(8);
                done();
            });

            master.on('error', (err) => { throw err });

            // Generate 10 jobs
            master.generateJobs = function(callback) {
                for(let i = 0; i < 10; i++) {
                    this.jobsQueue.push('job '+i);
                }
                callback();
            };

            master.onWorkerMessage = function(id, msg) {
                if (msg.cmd) {
                    switch(msg.cmd) {
                        case "ready":
                            readies++;
                            if (readies === 2) {
                                master.abort();
                            }
                            return;
                    }

                } else {
                    if (msg.callback) this.sendMessageToWorker(id, msg.cmd || "error", { error: "Unhandled command in custom handler!" }, msg.callback);
                }
            };

            master.start();
        });

    });
}


