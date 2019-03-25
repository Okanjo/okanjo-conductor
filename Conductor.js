"use strict";

const Async = require('async');
const OS = require('os');
const Cluster = require('cluster');
const EventEmitter = require('events').EventEmitter;
const ShortId = require('shortid');
const Util = require('util');

/**
 * Distributes job processing across multiple processes
 */
class Conductor extends EventEmitter {

    /**
     * Constructor
     * @param options
     */
    constructor(options) {
        super();
        options = options || {};

        this.workerType = options.workerType || 'conductor_worker';
        this.workerLimit = options.workerLimit || Math.min(4, OS.cpus().length);
        this.jobsQueue = options.jobsQueue || [];
        this.logging = options.logging !== undefined ? options.logging : true;
        this.processing = false;
        this.workerEnv = options.workerEnv || {};

        this.lookups = options.lookups || {};

        this.lastStats = {};
        this.workerStatsReportCount = 0;
        this.id = ShortId.generate();
        this._workerIds = [];

        // awaitable methods
        this.start = Util.promisify(this.start.bind(this));
        this.generateJobs = Util.promisify(this.generateJobs.bind(this));
    }

    //region Override These Methods

    /* istanbul ignore next: must be overridden to be useful */
    //noinspection JSMethodCanBeStatic
    /**
     * Generates the job list - you gotta implement this or use options.jobsQueue in the constructor
     * @param callback
     */
    generateJobs (callback) {
        // TODO - implement on child class
        // e.g. this.jobsQueue.push(job);
        callback();
    }

    /**
     * Hook point for custom master-worker messaging calls. Not necessarily needed
     * @param id
     * @param msg
     */
    onWorkerMessage(id, msg) {
        if (msg.cmd) {
            const callback = msg.callback;
            switch (msg.cmd) {

                case "override-me":
                    this.sendMessageToWorker(id, "override-me", 'nope', callback);
                    return;
            }
        }

        // If we got to here, the command is invalid
        this.error('Unknown message from worker', id, msg);

        /* istanbul ignore else: would cause a hang with no callback */
        if (msg.callback) this.sendMessageToWorker(id, msg.cmd || "error", { error: "Unhandled command! Override onWorkerMessage?" }, msg.callback);
    }

    //endregion

    //region Class Methods

    /**
     * Gets whether the job is still running
     * @return {boolean}
     */
    isProcessing() {
        return this.processing;
    }

    /**
     * Sends a message to a worker
     * @param id
     * @param commandName
     * @param data
     * @param callbackId
     */
    sendMessageToWorker(id, commandName, data, callbackId) {
        Cluster.workers[id].send({
            workerId: id,
            masterId: this.id,
            cmd: commandName,
            data: data,
            callback: callbackId
        });
    }

    /**
     * Broadcasts a message to all workers.
     * @param commandName
     * @param data
     */
    broadcastMessageToWorkers(commandName, data) {
        this._workerIds.forEach((id) => {
            this.sendMessageToWorker(id, commandName, data);
        });
    }

    /**
     * Shuts down all workers immediately
     */
    abort() {
        this.broadcastMessageToWorkers('!!ABORT!!', {});
    }

    /**
     * Returns the lookup map with the given name
     * @param name
     * @return {{}|*}
     */
    getLookup(name) {
        return this.lookups[name] || {};
    }

    /**
     * Returns the cached value (if defined) in the given lookup
     * @param name
     * @param key
     * @return {*}
     */
    getLookupValue(name, key) {
        const lookup = this.getLookup(name);
        if (lookup instanceof Map) {
            return lookup.get(key);
        } else {
            return lookup[key];
        }
    }

    /**
     * Sets a lookup value in the given lookup
     * @param name
     * @param key
     * @param value
     */
    setLookupValue(name, key, value) {
        const lookup = this.getLookup(name);
        if (lookup instanceof Map) {
            lookup.set(key, value);
        } else {
            lookup[key] = value;
        }
    }

    /**
     * Generates the job list and starts the workers
     * @param callback - Calls back when the initial worker pool has been started
     */
    start(callback) {
        /* istanbul ignore else: out of scope */
        if (Cluster.isMaster) {
            this.processing = true;
            Async.waterfall([

                // Generate the job queue
                (next) => this.generateJobs(next),

                // Start workers
                (next) => { this._startWorkers(); next(); }

            ], callback);
        } else {
            // Not master, don't conduct
            callback(new Error('Not master'));
        }
    }

    //endregion

    //region Internal Methods

    /**
     * Gets the next job to process
     * @return {*}
     */
    _getNextJob() {
        return this.jobsQueue.shift();
    }

    /**
     * Logs to the output if logging is enabled
     */
    log() {
        if (this.logging) console.log.apply(console, [].slice.call(arguments)); // eslint-disable-line no-console
    }

    /**
     * Logs to the output if logging is enabled
     */
    error() {
        if (this.logging) console.error.apply(console, [].slice.call(arguments)); // eslint-disable-line no-console
    }

    /**
     * Sawns a new instance of a worker
     */
    _startWorker() {
        this.workerEnv.worker_type = this.workerType;
        this.workerEnv.master_id = this.id;
        const worker = Cluster.fork(this.workerEnv),
            id = worker.id;

        this._workerIds.push(id+"");

        this.log(`> Started worker ${id}`);

        // Message handler
        Cluster.workers[id].on('message', (msg) => {
            if (msg && msg.cmd) {

                let job;
                let lookupName;
                let lookupKey;

                let setLookupName;
                let setLookupKey;
                let setLookupValue;

                let stats;

                switch (msg.cmd) {
                    // Get task
                    case "getJob":
                        job = this._getNextJob();
                        this.log(`> Assigned worker ${id} job:`, job);
                        this.sendMessageToWorker(id, "getJob", job, msg.callback);
                        break;

                    // Check master for known value
                    case "lookup":

                        lookupName = msg.data.name;
                        lookupKey = msg.data.key;

                        this.sendMessageToWorker(
                            id,
                            "lookup",
                            {
                                name: lookupName,
                                key: lookupKey,
                                value: this.getLookupValue(lookupName, lookupKey)
                            }, msg.callback
                        );
                        break;

                    // Set master known value
                    case "setLookup":
                        setLookupName = msg.data.name;
                        setLookupKey = msg.data.key;
                        setLookupValue = msg.data.value;

                        this.setLookupValue(setLookupName, setLookupKey, setLookupValue);
                        this.sendMessageToWorker(id, "setLookup", null, msg.callback);
                        break;

                    case "stats":
                        stats = msg.data;
                        this._updateStatsForWorker(id, stats);
                        this.sendMessageToWorker(id, "stats", null, msg.callback);
                        break;

                    default:
                        this.onWorkerMessage(id, msg);
                }
            } else {
                this.onWorkerMessage(id, msg);
            }
        });

        // Exit strategy
        Cluster.workers[id].on('exit', (code, signal) => this._onWorkerExit(id, code, signal));
    }

    /**
     * Integrates a worker's metrics into the overall stats of the processor
     * @param id
     * @param stats
     */
    _updateStatsForWorker(id, stats) {
        this.lastStats[id] = stats;
        this.workerStatsReportCount++;

        // Let I/O settle before doing this, maybe we'll get other reports in before it fires?
        setImmediate(() => this._reportStats());
    }

    /**
     * Aggregates and emits the stats event
     */
    _reportStats() {
        const workersCount = Object.keys(Cluster.workers).length;
        const submissionCount = this.workerStatsReportCount;
        if (submissionCount >= workersCount) {
            // Print out the report!
            const stats = this.lastStats;
            this.workerStatsReportCount = 0;

            // Aggregate stats?
            const agg = {
                last: {},
                diff: {}
            };

            let timeSpanSum = 0;

            // worker => stats
            Object.keys(stats).forEach((id) => {
                timeSpanSum += stats[id].timeSpan;
                Object.keys(stats[id].last).forEach((key) => {
                    if (agg.last[key] === undefined) {
                        agg.last[key] = stats[id].last[key];
                    } else {
                        agg.last[key] += stats[id].last[key];
                    }
                });
                Object.keys(stats[id].diff).forEach((key) => {
                    if (agg.diff[key] === undefined) {
                        agg.diff[key] = stats[id].diff[key];
                    } else {
                        agg.diff[key] += stats[id].diff[key];
                    }
                });
            });

            /**
             * Stats Event
             * @event Conductor#stats
             * @type {{raw: object, avgTimeSpan: number, agg: object}}
             */
            this.emit('stats', { raw: stats, avgTimeSpan: timeSpanSum / submissionCount, agg: agg });
        }
    }

    /**
     * Handles the worker exit event
     * @param id
     * @param code
     * @param signal
     */
    _onWorkerExit(id, code, signal) {
        // If the worker blew up, spawn another to replace it
        this.log(`> Worker ${id} ended with code ${code} signal ${signal}`);

        // Deregister this worker id from our id bucket
        const index = this._workerIds.indexOf(""+id);
        /* istanbul ignore else: out of scope */
        if (index >= 0) {
            this._workerIds.splice(index, 1);
        }

        if (code !== 0) {
            /**
             * Error Event - Occurs when a worker crashes or another bad thing happens
             * @event Conductor#error
             * @type {{type:string, workerId: number, code: number, signal: number}}
             */
            this.emit('error', { type: 'worker_crash', workerId: id, code: code, signal: signal });
            this._startWorker();
        } else {
            this._checkForCompletion();
        }
        this.emit('worker_exit', { id, code, signal });
    }

    /**
     * Checks whether aall the workers are done and whether to bail
     */
    _checkForCompletion() {
        // Any other workers left?
        const workerCount = Object.keys(Cluster.workers).length;
        if (workerCount === 0) {
            this.log(`> No more workers. Closing up shop.`);
            this.processing = false;

            /**
             * Work Completed Event
             * @event Conductor#end
             * @type {null}
             */
            this.emit('end');
            clearInterval(this.completionTimer);
        } else {
            this.log(`> Waiting on ${workerCount} other workers to finish.`);

            // Once a worker ends normally, then the light at the tunnel is in sight.
            // To prevent whacky race conditions, lets set up a timer to recheck if we're done yet
            // just in case something ends w/o setting workerCount to zero
            if (this.completionTimer) {
                clearInterval(this.completionTimer);
            }
            this.completionTimer = setInterval(() => this._checkForCompletion(), 500);
        }
    }

    /**
     * Starts the initial set of workers
     */
    _startWorkers() {
        for(let i = 0; i < this.workerLimit; i++) {
            this._startWorker();
        }
    }

    //endregion
}

module.exports = Conductor;