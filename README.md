# CAF (Cloud Assistant Framework)

Co-design permanent, active, stateful, reliable cloud proxies with your web app.

See http://www.cafjs.com 

## CAF Lib Sharing

[![Build Status](http://ci.cafjs.com/github.com/cafjs/caf_sharing/status.svg?branch=master)](http://ci.cafjs.com/github.com/cafjs/caf_sharing)


This repository contains a CAF lib to implement distributed data structures needed by Sharing Actors.

Sharing Actors do not change the core semantics of normal actors but they can use shared-memory efficiently.


## API

    lib/proxy_sharing.js
    
 
## Configuration Example

### framework.json

       {
            "name": "cp"
        },
        {
            "name": "cp2",
            "module" : "caf_redis#plug",
            "description" : "Checkpointing service",
            "env" : {
               "nodeId": "default",
               "redis" : {
                   "password" : null,
                   "host" : "localhost",
                   "port" : 6379
                },
                "coalescing" : {
                    "interval" : 10,
                    "maxPendingUpdates" : 20
                }
            }
        },
        {
            "name": "sharing",
            "module": "caf_sharing#plug",
            "description": "Sharing service",
            "env" : {
                "persistService" : "cp",
                "routeService" : "cp2"
            }
        }

        
We need a separate connection to the Redis backend to support concurrent pubsub +checkpointing.
        

### ca.json
  
        {
            "module": "caf_sharing#plug_ca",
            "name": "sharing",
            "description": "Manages Shared Maps for a CA",
            "env" : {
                "maxRetries" : "$._.env.maxRetries",
                "retryDelay" : "$._.env.retryDelay"
            },
            "components" : [
                {
                    "module": "caf_sharing#proxy",
                    "name": "proxy",
                    "description": "Allows access to this CA Shared Maps",
                    "env" : {
                    }
                }
            ]
        }

        
            
 
