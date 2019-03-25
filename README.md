# Okanjo Conductor

[![Build Status](https://travis-ci.org/Okanjo/okanjo-conductor.svg?branch=master)](https://travis-ci.org/Okanjo/okanjo-conductor) [![Coverage Status](https://coveralls.io/repos/github/Okanjo/okanjo-conductor/badge.svg?branch=master)](https://coveralls.io/github/Okanjo/okanjo-conductor?branch=master)

Module for handing batch jobs across multiple worker processes via Cluster.

## Installing

Add to your project like so: 

```sh
npm install okanjo-conductor
```

## Breaking Changes

### v2.0.0
 * ConductorWorker – master messaging callbacks are now of signature `(err, data)` instead of `(data)`
   * `fireRequestCallback(name, err, data)`
   * `sendRequestToMaster(name, data, (err, data) => {...})`
   * `getNextJob((err, job) => {...})`
   * `lookup(name, key, (err, val) => {...})`
   * `setLookup(name, key, value, (err) => {...})`

## Example Usage

Here's a super basic, single file demonstration. 

```js
const Cluster = require('cluster');
const Conductor = require('okanjo-conductor');
const ConductorWorker = require('okanjo-conductor/ConductorWorker');
const Util = require('util');

// Check if we're a fork or not
if (Cluster.isMaster) {
    // If we are the master process, then start the conductor

    const conductor = new Conductor({
        workerType: 'my_math_processor',
        workerLimit: 2, // at most keep 2 workers alive
        logging: false
    });

    // Override job generator, or you could set it in the constructor above ^
    conductor.generateJobs = Util.promisify(function (callback) {
        for (let i = 0; i < 10; i++) {
            this.jobsQueue.push(i); // jobs are queued as numbers, but you could queue anything
        }

        // Finished queuing jobs.
        callback();
    }).bind(conductor);

    conductor.on('error', (err) => {
        console.error('Handle your big bad errors here', err);
    });

    conductor.once('end', (err) => {
        console.log('All jobs finished processing');
    });

    conductor.start();


} else {
    // If we are a worker process, then start the appropriate type of conductor worker
    const workerType = process.env.worker_type;
    if (workerType === 'my_math_processor') {

        class MyMathProcessor extends ConductorWorker {
            constructor() {
                super({
                    logging: false
                });
            }

            processJob(job) {
                //display the square of the number we are processing
                console.log(`Worker ${this.workerId}, Job ${job} => the square is ${job * job}`);

                // let's pretend that this took a while to complete
                setTimeout(() => {
                    this.completeJob(null, job);
                }, 1000);
            }
        }

        const worker = new MyMathProcessor();
        worker.start();
        // this process will terminate when there are no more jobs to process
    }
}
```

The above will generate the following output:
```text
Worker 1, Job 0 => the square is 0
Worker 2, Job 1 => the square is 1
Worker 1, Job 2 => the square is 4
Worker 2, Job 3 => the square is 9
Worker 2, Job 4 => the square is 16
Worker 1, Job 5 => the square is 25
Worker 1, Job 6 => the square is 36
Worker 2, Job 7 => the square is 49
Worker 1, Job 8 => the square is 64
Worker 2, Job 9 => the square is 81
All jobs finished processing 
```

You can make this much more elaborate by launching multiple conductors, separating workers to their own modules, and so on.

# Conductor

Job manager class, manages the task distribution and workers.

## Properties

* `conductor.workerType` – (read only) The name given to the workers spawned from this conductor. Default is `conductor_worker`.
* `conductor.workerLimit` – (read only) The maximum number of workers the conductor may spawn. Default is the number of CPUs on the system or `4`, which ever is least.
* `conductor.jobsQueue` – Array of objects to that should be distributed to workers to process. 
* `conductor.logging` – Whether verbose output should generated to stdout/stderr. Default is `true`.
* `conductor.processing` – (read only) Whether the conductor has started processing the job queue. 
* `conductor.workerEnv` – (read only) Contextual data passed to workers. Default is `{}`. 
* `conductor.lookups` – Object map to hold referential lookup data, keyed by the name of the lookup. Default is `{}`.
* `conductor.lastStats` – (read only) The aggregated statistics from the last report cycle.
* `conductor.workerStatsReportCount` – (read only) How many workers provided statistics in the last cycle.
* `conductor.id` – (read only) The unique id of the conductor, used for master-worker isolation.

## Methods

### `new Conductor([options])`
Creates a new conductor for managing tasks.
* `options` – (optional) The configuration object
  * `options.workerType` – The name given to the workers spawned from this conductor. Default is `conductor_worker`.
  * `options.workerLimit` – The maximum number of workers the conductor may spawn. Default is the number of CPUs on the system or `4`, which ever is least.
  * `options.jobsQueue` – Array of objects to that should be distributed to workers to process.
  * `options.logging` – Whether verbose output should generated to stdout/stderr. Default is `true`.
  * `options.workerEnv` – Contextual data passed to workers. Default is `{}`.
  * `options.lookups` – Object map to hold referential lookup data, keyed by the name of the lookup. Default is `{}`.

### `conductor.generateJobs([callback])`
Hook point for generating the job queue when the conductor is started. Override the method if needed.
* `callback(err)` – Optional, Callback to fire when completed with generating the job queue. Provide an `err` if needed.
* Should return a promise

For example:
```js
conductor.generateJobs = Util.promisify(function(callback) {
    for(let i = 0; i < 10; i++) {
        this.jobsQueue.push(i); // jobs are queued as numbers
    }
    
    // or you could just set this.jobsQueue = [0,1,2,3,4,5,6,7,8,9];
    
    // When finished, callback, optionally with an error param if you need to abort
    const err = null; 
    callback(err); 
}).bind(conductor);
``` 
 
### `conductor.onWorkerMessage(id, msg)`
Hook point for handing custom messages from workers. Override this method if you would like to use custom messaging.
* `id` – The worker id that sent the message
* `msg` – The message object that was sent
  * `msg.cmd` – The name of the command the worker requested
  * `msg.masterId` – The `id` of the conductor that manages this worker
  * `msg.data` – The payload provided by the worker
  * `msg.callback` – The optional callback id reference to fire when issuing a reply  

For example:
```js
conductor.onWorkerMessage = function(id, msg) {
    let replied = false;
    if (msg.cmd === "workerSaidHello") {
        // do something with msg.data
        
        // maybe we could reply to the worker and say hello back!
        if (msg.callback) {
            this.sendMessageToWorker(id, msg.cmd, { hello: "to you too!"}, msg.callback);
            replied = true;
        }
    } else if (msg.cmd === "WorkerSaidFYI") {
        // we could do something with msg.data
        // but since it's just an "FYI" maybe we don't  need to send a special reply
    }
    
    if (!replied && msg.callback) this.sendMessageToWorker(id, msg.cmd || "error", { ack: true }, msg.callback);
}

```

### `conductor.isProcessing()`
Returns `true` if the conductor is currently burning down the job queue or `false` if not.

### `conductor.sendMessageToWorker(id, commandName, data, [callbackId])`
Sends a message to a worker.
* `id` – The id of the worker to send a message to.
* `commandName` – The string name of the command the worker is expected to handle.
* `data` – Payload to include with the message
* `callbackId` – Callback id reference the worker can use if this is a reply.
 
### `conductor.broadcastMessageToWorkers(commandName, data)`
Sends a message to all workers.
* `commandName` – The string name of the command the worker is expected to handle.
* `data` – Payload to include with the message

### `conductor.abort()`
Instructs all workers to shutdown.

### `conductor.getLookup(name)`
Returns a lookup object from the conductor with the given key name.
* `name` – String name of the lookup

### `conductor.getLookupValue(name, key)`
Returns a value from the a lookup with the given key.
* `name` – String name of the lookup
* `key` – The key to lookup.
  
This method automatically handles whether the lookup is a simple Object with key-value pairs or a Map Object.

For example:
```js

conductor.lookups = {
    fruits: {
        a: "apple",
        b: "banana"
    },
    veggies: new Map([ ["c", "carrot"], ["d", "dill"] ])
}

conductor.getLookupValue("fruits", "a"); // returns "apple"
conductor.getLookupValue("veggies", "c"); // returns "carrot"

```
  
### `conductor.setLookupValue(name, key, value)`
* Sets a key-value pair in the given lookup object.
* `name` – String name of the lookup
* `key` – The key name to set
* `value` – The value to assign to the key

This method automatically handles whether the lookup is a simple Object with key-value pairs or a Map Object.

For example:
```js

conductor.lookups = {
    fruits: {
        a: "apple",
        b: "banana"
    },
    veggies: new Map([ ["c", "carrot"], ["d", "dill"] ])
}

conductor.setLookupValue("veggies", "e", "eggplant")
conductor.setLookupValue("fruits", "f", "fig")

conductor.getLookupValue("veggies", "e"); // returns "eggplant"
conductor.getLookupValue("fruits", "f"); // returns "fig"

```

### `conductor.start([callback])`
* Starts the conductor, which will call `conductor.generateJobs()` before starting the workers.
* `callback(err)` – Optional, Function to fire when conductor has finished processing. `err` may be set if there was a problem processing.
* Returns a Promise

## Events

### `conductor.on('stats', (data) => {...})`
Fired when conductor statistics are available. Useful for reporting worker benchmarks while processing.
* `data.raw` - The raw statistics, includes all worker stats as provided.
* `data.agg` – Aggregated stats from all workers.
  * `data.agg.last` – The object map containing the sum of the keys from all workers
  * `data.agg.diff` – The difference from the previous report's aggregated value 
* `data.avgTimeSpan` – The average timespan this report covers (useful for calculating metric-per-second)

### `conductor.on('error', (error) => { ... })`
Fired when an error occurs while processing.
* `error.type` – Type of error that occurred. One of: `worker_crash`
* `error.workerId` – The id of the worker that was responsible for the event, if applicable
* `error.code` – The exit code from the worker, if applicable
* `error.signal` – The exit signal from the worker, if applicable

Note: You need to add an event handler for this, otherwise EventEmitter will throw a fatal error if not handled!

### `conductor.on('worker_exit', (data) => {...}`)`
Fired when a worker has exited.
* `data.id` – The id of the worker that exited
* `error.code` – The exit code from the worker
* `error.signal` – The exit signal from the worker

### `conductor.once('end', () => {...}`)`
Fired when the conductor has finished processing all jobs.


# ConductorWorker 

Base class for job workers. You need to extend this class to make it do anything.

## Properties

* `worker.workerId` – (read only) The id of this cluster worker
* `worker.masterId` – (read only) The id of the conductor that is responsible for this worker
* `worker.stats` – Object that holds the worker's key-value counter metrics  
* `worker.lastStats` – (read only)  Copy of the worker stats last reported
* `worker.statsInterval` – (read only) How often (in milliseconds) the worker should report stats
* `worker.logging` – (read only) Whether or not to display verbose logging messages 

## Methods

### `new ConductorWorker([options])`
Constructs a new instance of a worker.
* `options` – (optional) Configuration object
  * `options.stats` – Object that holds the worker's key-value counter metrics. Defaults to `{ jobsDone: 0 }`
  * `options.statsInterval` –  How often (in milliseconds) the worker should report stats. Defaults to `5000` (5 seconds)
  * `options.logging` – Whether or not to display verbose logging messages. Defaults to `true`.

### `worker.processJob(job)`
Hook point for processing a job received from the conductor.
* `job` – Job object provided by the conductor from the jobQueue.

When done processing a job, you must call `this.completeJob(err, job)`.

For example:
```js

const worker = new ConductorWorker();

worker.processJob = function(job) {
    console.log('Hey, we got a job to do', job);
    
    // Flag that we completed processing this job.
    this.completeJob(null, job);
};

worker.start();

```

### `worker.onMasterMessage(msg)` 
Hook point for handling custom messages received by the conductor on a worker.
* `msg` – The message object that was sent
  * `msg.cmd` – The name of the command the master requested
  * `msg.masterId` – The `id` of the conductor that manages this worker
  * `msg.data` – The payload provided by the conductor
  * `msg.callback` – The optional callback id the conductor was replying to

For example:
```js
worker.onMasterMessage = function(msg) {
    if (msg.cmd === "workerSaidHello") {
        // do something with msg.data
        
       console.log('Hey, the conductor said', msg.data);
       
    }

    // If there was a callback on this worker associated with the message, fire it
    if (msg.callback) this.fireRequestCallback(msg.callback, null, msg);
};
```

### `worker.completeJob(err, job)`
Call this function to complete work after processing a job.
* `err` – If there was an error processing the job, make this truthy to fail processing.
* `job` – The job object provided by `processJob(job)` that was completed.

### `worker.crash([err])`
Stops and terminates the worker, reporting any pending statistics that may have been queued. If applicable, a new worker 
will be issued to replace this one. Use this in the event something goes horribly wrong and only a reload would fix it.
* `err` – The error that was responsible for the crash, if available  

### `worker.sendRequestToMaster(commandName, data, [callback])`
Sends a message to the conductor. Use this to send a message to the master process / conductor.
* `commandName` – Name of the command the master should handle
* `data` – Message payload
* `callback(err, data)` – (optional) Function to fire when the master replies to the message.
* Returns a promise

### `worker.fireRequestCallback(callbackName, data)`
Executes a callback given the callback id. Use this when you handle custom messages in `worker.onMasterMessage(...)`.
* `callbackName` – The id of the callback to file
* `data` – Payload provided to the callback

### `worker.lookup(name, key, [callback])`
Looks up a value given a lookup name and key on the master process conductor. This is useful when storing large 
referential data sets in memory, so that each worker process doesn't need to duplicate the same reference set in memory.
Only the master process conductor will store it, and each worker can reference it through process i/o.
* `name` – String name of the lookup
* `key` – The key name to set
* `callback(err, data)` – (optional) Function to fire when conductor returned the value
* Returns a promise
  
### `worker.setLookup(name, key, value, [callback])`
Sets a key-value pair in the given lookup on the master process conductor. Use this if lazy loading a referential lookup
or if the worker can modify a the lookup data store.
* `name` – String name of the lookup
* `key` – The key name to set
* `value` – The value to assign to the key
* `callback(err, data)` – (optional) Function to fire when the conductor completed the operation
* Returns a promise

### `worker.start([callback])`
Starts the worker by listening to messages sent from the conductor, statistics monitoring, and begins processing jobs.
* `callback(err)` – (optional) Fired when the worker has completed or failed to complete.
* Returns a promise
 
### `worker.startMonitoring()`
Starts statistics reporting if stopped. This is done automatically, but you may wish to enable/disable this as you wish.

### `worker.stopMonitoring()`
Stops statistics reporting if started. This is done automatically, but you may wish to enable/disable this as you wish.

## Extending and Contributing 

Our goal is quality-driven development. Please ensure that 100% of the code is covered with testing.

Before contributing pull requests, please ensure that changes are covered with unit tests, and that all are passing. 

### Testing

To run unit tests and code coverage:
```sh
npm run report
```

This will perform:
* Unit tests
* Code coverage report
* Code linting

Sometimes, that's overkill to quickly test a quick change. To run just the unit tests:
 
```sh
npm test
```

or if you have mocha installed globally, you may run `mocha test` instead.
