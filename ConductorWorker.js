"use strict";

const Async = require('async');
const Cluster = require('cluster');
const EventEmitter = require('events').EventEmitter;
const ShortId = require('shortid');
const Util = require('util');

/**
 * Conductor worker base class. Should be extended to be useful!
 */
class ConductorWorker extends EventEmitter {

    /**
     * Constructor
     * @param options
     */
    constructor(options) {
        super();

        options = options || {};
        this.workerId = Cluster.worker.id;
        this.masterId = process.env.master_id; // Which master is managing this worker

        // Bucket for random counters
        this.stats = options.stats || {
            jobsDone: 0
        };
        this.lastStats = {};
        this._statsHrTime = process.hrtime();
        this.statsInterval = options.statsInterval || 5000;

        // Buckets
        this._requestCallbacks = {};
        this.logging = options.logging !== undefined ? options.logging : true;

        // awaitable methods
        this.start = Util.promisify(this.start.bind(this));
        this.bindRouter = Util.promisify(this.bindRouter.bind(this));
        this.setLookup = Util.promisify(this.setLookup.bind(this));
        this.lookup = Util.promisify(this.lookup.bind(this));
        this.getNextJob = Util.promisify(this.getNextJob.bind(this));
        this.sendRequestToMaster = Util.promisify(this.sendRequestToMaster.bind(this));
    }

    //region Override These Methods

    /* istanbul ignore next: must be implemented */
    /**
     * Processes a job. Please make this do something!
     * @param job
     */
    processJob(job) {
        // Do
        // Whatever
        // You need
        // To do
        // Then call:
        // completeJob(err, job) // err if it failed or no error if it did not. SEND BOTH
        this.completeJob(undefined, job);
    }

    /**
     * Hook point for custom master-worker messaging calls
     * @param msg
     */
    onMasterMessage(msg) {
        /* istanbul ignore else: there's no easy way to make the master not send a cmd */
        if (msg.cmd) {
            switch (msg.cmd) {

                case "override-me":
                    this.log('got dummy message back');
                    this.fireRequestCallback(msg.callback, null, msg);
                    return;
            }
        }

        // If we got to here, the command is invalid
        this.error('Unknown message from master! workerid:', this.workerId, msg);

        /* istanbul ignore else: would cause a hang with no callback */
        if (msg.callback) this.fireRequestCallback(msg.callback, null, msg);
    }

    //endregion

    //region Class Methods

    /**
     * Should be called when a job is done
     * @param err
     * @param job
     */
    completeJob(err, job) {

        this.stats.jobsDone++;

        if (err) {
            /**
             * Worker Error Event
             * @event ConductorWorker#error
             * @type {{job:object,error:object}}
             */
            this.emit('error', { job: job, error: err });
            this.crash(err);
        } else {
            // Notify
            /**
             * Job completed event
             * @event ConductorWorker#job_done
             * @type {object}
             */
            this.emit('job_done', job);

            // Get the next job
            this.getNextJob();
        }

    }

    /**
     * Crashes the worker so the master should restart it - use when shit goes south
     * @param err
     */
    crash(err) {
        this.error('> !! Got error in processing job, workerId: ', this.workerId, err);
        this.stopMonitoring();
        this.rollStats();
        process.exit(4);
    }

    /**
     * Fired when there are no more jobs to process
     */
    done() {
        /**
         * Worker Finished Event – occurs when no more jobs are available to process and will shutdown
         * @event ConductorWorker#completed
         * @type {null}
         */
        this.emit('completed');
        this.stopMonitoring();
        this.rollStats();
        return process.exit(0);
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
     * Diffs the stats against the previous run
     */
    rollStats() {
        const diff = {};
        const timeDiff = process.hrtime(this._statsHrTime);
        const seconds = (timeDiff[0] * 1e9 + timeDiff[1]) / 1e9;
        this._statsHrTime = process.hrtime();

        // Compare / Update values
        Object.keys(this.stats).forEach((key) => {
            diff[key] = this.stats[key] - (this.lastStats[key] || 0);
            this.lastStats[key] = this.stats[key];
        });

        // Send it
        /**
         * Worker Stats Event – Occurs when stats are available for reporting
         * @event ConductorWorker#stats
         * @type {{workerId:number, timeSpan:number, diff:object, last:object}}
         */
        this.emit('stats', {
            workerId: this.id,
            timeSpan: seconds,
            diff: diff,
            last: this.lastStats
        });

        // Notify master
        this.sendRequestToMaster('stats', {
            timeSpan: seconds,
            diff: diff,
            last: this.lastStats
        });
    }

    /**
     * Starts periodic stats monitoring
     */
    startMonitoring() {
        this.interval = setInterval(() => this.rollStats(), this.statsInterval);
    }

    /**
     * Stops perodic stats monitoring
     */
    stopMonitoring() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    /**
     * Fired when a job is received from the master
     * @param msg
     * @return {*}
     */
    handleJobReceived(msg) {
        // Send the worker the next day on top of the queue
        const job = msg.data;
        if (job === undefined) {
            this.log(`> Worker ${this.workerId} is received no job. Exiting!`);
            return this.done();
        }

        // Process the job
        this.processJob(job);

        this.fireRequestCallback(msg.callback, null, job);
    }

    /**
     * Fired when a lookup result is received from the master
     * @param msg
     */
    handleLookupReceived(msg) {
        const keyMapName = msg.data.name;
        const keyMapKey = msg.data.key;
        const keyMapValue = msg.data.value;
        const callbackName = msg.callback;
        this.fireRequestCallback(callbackName, null, { name: keyMapName, key: keyMapKey, value: keyMapValue });
    }

    /**
     * Fired when a set result is received from the master
     * @param msg
     */
    handleSetLookupReceived(msg) {
        const callbackName = msg.callback;
        this.fireRequestCallback(callbackName);
    }

    /**
     * Fires a callback, if it's present
     * @param callbackName
     * @param err
     * @param data
     */
    fireRequestCallback(callbackName, err, data) {
        if (typeof this._requestCallbacks[callbackName] === "function") {
            this._requestCallbacks[callbackName](err, data);
            delete this._requestCallbacks[callbackName];
        } else if (this._requestCallbacks[callbackName] === null) {
            // No callback, ignore
        } else {
            this.stopMonitoring();
            const err = new Error(`> !! Worker ${this.workerId} could not locate callback ${callbackName}... I think we're stuck?`);
            this.crash(err.stack);
        }
    }

    /**
     * Sends a message to the master process
     * @param commandName
     * @param data
     * @param callback
     */
    sendRequestToMaster(commandName, data, callback) {
        const callbackName = ShortId.generate();
        if (callback) {
            this._requestCallbacks[callbackName] = callback;
        } else {
            this._requestCallbacks[callbackName] = null;
        }
        process.send({
            cmd: commandName,
            masterId: this.masterId,
            data: data,
            callback: callbackName
        });
    }

    /**
     * Asks for a new job to process
     * @param callback
     */
    getNextJob(callback) {
        this.sendRequestToMaster('getJob', null, callback);
    }

    /**
     * Sends a lookup request to the master
     * @param name
     * @param key
     * @param callback
     */
    lookup(name, key, callback) {
        this.sendRequestToMaster('lookup', { name: name, key: key }, callback);
    }

    /**
     * Sends a setlookup request to the master
     * @param name
     * @param key
     * @param value
     * @param callback
     */
    setLookup(name, key, value, callback) {
        this.sendRequestToMaster('setLookup', { name: name, key: key, value: value }, callback);
    }

    /**
     * Binds the inter-process messaging events
     * @param callback
     */
    bindRouter(callback) {
        // Message handler from master
        process.on('message', (msg) => {
            if (msg.cmd) {
                switch (msg.cmd) {

                    case "getJob":
                        return this.handleJobReceived(msg);

                    case "lookup":
                        // Send the worker the value of they keymap
                        return this.handleLookupReceived(msg);

                    case "setLookup":
                        // Send the worker the value of they keymap
                        return this.handleSetLookupReceived(msg);

                    case '!!ABORT!!':
                        return this.done();

                    default:
                        return this.onMasterMessage(msg);
                }
            }

            // If we got to here, the command is invalid
            return this.onMasterMessage(msg);
        });

        callback();
    }

    /**
     * Starts the worker processor
     * @param callback - Calls back when the initial worker pool has been started
     */
    start(callback) {
        /* istanbul ignore else: out of scope */
        if (Cluster.isWorker) {
            Async.series([

                // Generate the job queue
                (next) => this.bindRouter(next),

                // Start workers
                (next) => this.getNextJob(() => {
                    next();
                }),

                // Start monitoring
                (next) => {
                    this.startMonitoring();
                    next();
                }

            ], callback);
        } else {
            // Not a worker, don't do any work!
            callback(new Error('Not a worker'));
        }
    }

    //endregion
}

module.exports = ConductorWorker;