# CAF (Cloud Assistant Framework)

Co-design permanent, active, stateful, reliable cloud proxies with your web app.

See http://www.cafjs.com 

## CAF Lib Sharing

This repository contains a CAF lib to implement distributed data structures needed by Sharing Actors.


## API

    lib/proxy_sharing.js
    
 
## Configuration Example

### framework.json

       "plugs": [
        {
            "module" : "caf_sharing/plug",
            "name" : "sharing_mux",
            "description" : "Shared connection to a Sharing Maps service\n Properties: <spine> Spine service configuration data\n",
            "env" : {
                "spine": {
                   "persist" : {
                     "service": {
                       "hostname": "redis1.foo.com",
                       "port": 6379,
                       "password": "pleasechange"
                     }                   
                   },
                   "route" : {
                     "service": {
                       "hostname": "redis2.foo.com",
                       "port": 6379,
                       "password": "pleasechange"
                     }                   
                   }                
                }
            }
        }
        
        
If the property `spine` is **not defined** we use the default Redis server (used also for checkpointing) to implement both the `route` and `persist` services that are part of the `Spine`. **This is the recommended setting** because the Cloud Foundry plug-in gets the default (Redis) service  configuration transparently.
        

### ca.json

    "internal" : [
      {
            "module": "caf_sharing/plug_ca",
            "name": "sharing_ca",
            "description": "Provides a  service to create Sharing Maps visible to this CA",
            "env" : {

            }
        }
        ...
     ]
     "proxies" : [
      {
            "module": "caf_sharing/proxy",
            "name": "sharing",
            "description": "Proxy to access the Sharing Maps service",
            "env" : {

            }
        },
        ...
      ]
  
  
    
        
            
 
