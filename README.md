# Caf.js

Co-design cloud assistants with your web app and IoT devices.

See https://www.cafjs.com

## Library for Implementing Sharing Actors

[![Build Status](https://github.com/cafjs/caf_sharing/actions/workflows/push.yml/badge.svg)](https://github.com/cafjs/caf_sharing/actions/workflows/push.yml)



This repository implements distributed, replicated data structures for *Sharing Actors*, a core abstraction for our CAs.

In a traditional Actor model, Actor's state is private, and data sharing is implemented by exchanging messages. This simplifies concurrent programming by avoiding data races, deadlocks, and complex fault recovery.

Unfortunately, when slow changing data has to be shared by many Actors, the most efficient solutions use shared memory, and that breaks the Actor model.

Does it? Can we create a system that from the outside looks like a duck, walks like a duck, but it combines a shared data structure with an Actor model, in a way that we cannot tell it is not a pure Actor model?

In the general case we can't. The shared data structure is seen as internal state by many Actors. Changes by one of them could be visible by others in the middle of processing a message, breaking message serialization.

But if we make certain assumptions we can!

1. *Single Writer*: one Actor *owns* the data structure, the others can only read it. Everybody sees the data structure as internal state.

2. *Readers Isolation*: a read-only view of the data structure can only change between messages.

3. *Fairness*: an Actor cannot indefinitely block other local Actors from seeing new updates.

4. *Writer Atomicity*: changes are flushed, as an atomic unit, when the processing of a message finishes. No partial data leaks allowed.

5. *Consistency*: implements monotonic read consistency, i.e., replicas can be stale, but they never roll back to older versions.

And these properties are not that difficult to guarantee in `Caf.js`.

In `Caf.js` a CA ({@link external:caf_ca}) is an Actor, and an example of a shared data structure is a *SharedMap* ({@link module:caf_sharing/SharedMap}).

We name a *SharedMap*  with a local name in the context of the CA that owns it, and this makes it trivial to enforce *Single Writer*.

`Caf.js` processes a message within a transaction, and changes to a *SharedMap* are also part of that transaction, guaranteeing *Writer Atomicity*.

Monotonic read consistency is enforced by using version numbers to identify change sets.

The tricky part is how to guarantee both *Fairness* and *Readers Isolation* at the same time, since they impose conflicting requirements. The solution is to have multiple local versions of a *SharedMap*, and pick the most recent one when processing a new message.  When all the CAs using an old version finish processing its current message, that version gets garbage collected.

*SharedMaps* are implemented with persistent data structures, i.e., `Immutable.js`, to efficiently maintain many read-only snapshots. Since *SharedMaps* can be easily replicated in the browser (and IoT devices.), these persistent data structures are also used by *React/Redux* to speed up user interfaces.

*SharedMaps* can contain serialized methods that `Caf.js` uses to dynamically change the behavior of CAs and IoT devices.. For example, we can hide schema changes by adding getters and setters, or provide new functionality to a device, or change the rules on how CAs react to certain events...

And those changes respect  *Single Writer*, *Writer Atomicity*,  *Readers Isolation*, *Fairness*, and *Consistency*, enabling **safe** adaptive behavior.

Let's look at some examples:

### Hello World (see `examples/helloworld`)

Each user has a privileged CA called `admin` that owns a *SharedMap*. All the CAs belonging to this user replicate this map. CAs could be running in different node.js processes, deployed across multiple servers or VMs.

Helper functions to identify the privileged CA, and the name of the *SharedMap*:

```
const ADMIN_CA = 'admin';
const ADMIN_MAP = 'primarySharedMap';
const isAdmin = function(self) {
    const name = self.__ca_getName__();
    return (caf.splitName(name)[1] === ADMIN_CA);
};
const primaryMap = function(self) {
    const name = self.__ca_getName__();
    return caf.joinName(caf.splitName(name)[0], ADMIN_CA, ADMIN_MAP);
};
```

and the CA methods that implement a counter as a *SharedMap* entry:

```
exports.methods = {
    async __ca_init__() {
        if (isAdmin(this)) {
            this.$.sharing.addWritableMap('primary', ADMIN_MAP);
        }
        this.$.sharing.addReadOnlyMap('replica', primaryMap(this));
        return [];
    },
    async increment() {
        const $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            const counter = $$.primary.get('counter') || 0;
            $$.primary.set('counter', counter + 1);
            return [null, counter];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getCounter() {
        const $$ = this.$.sharing.$;
        return [null, $$.replica.get('counter')];
    }
};
```

### Hello Adaptive (see `examples/helloadaptive`)

Let's add dynamic behavior to the previous example.

The privileged CA installs in the *SharedMap* a serialized method `computeLabel()` that generates a random label. The method is created with `setFun()` and invoked with `applyMethod()`. Methods can take external arguments (`prefix`), or read map values (`base`).

```
exports.methods = {
    ...
    async install(base) {
        const $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            $$.primary.set('base', base);
            const body = "return prefix + (this.get('base') + Math.random());";
            $$.primary.setFun('computeLabel', ['prefix'], body);
            return [null, base];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getLabel(prefix) {
        const $$ = this.$.sharing.$;
        try {
            return [null, $$.replica.applyMethod('computeLabel', [prefix])];
        } catch (err) {
            return [err];
        }
    }
};
```

Changes to `base` and `computeLabel` are committed in a single transaction, eliminating dangerous transients.

Also, if inside `getLabel()` we call the method `computeLabel()` multiple times, even with asynchronous control flow between calls, the  *Readers Isolation* property guarantees that the method does not change.
