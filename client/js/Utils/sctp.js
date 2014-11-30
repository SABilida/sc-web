
var SctpCommandType = {
    SCTP_CMD_UNKNOWN:           0x00, // unkown command
    SCTP_CMD_CHECK_ELEMENT:     0x01, // check if specified sc-element exist
    SCTP_CMD_GET_ELEMENT_TYPE:  0x02, // return sc-element type
    SCTP_CMD_ERASE_ELEMENT:     0x03, // erase specified sc-element
    SCTP_CMD_CREATE_NODE:       0x04, // create new sc-node
    SCTP_CMD_CREATE_LINK:       0x05, // create new sc-link
    SCTP_CMD_CREATE_ARC:        0x06, // create new sc-arc
    SCTP_CMD_GET_ARC:           0x07, // return begin element of sc-arc

    SCTP_CMD_GET_LINK_CONTENT:  0x09, // return content of sc-link
    SCTP_CMD_FIND_LINKS:        0x0a, // return sc-links with specified content
    SCTP_CMD_SET_LINK_CONTENT:  0x0b, // setup new content for the link
    SCTP_CMD_ITERATE_ELEMENTS:  0x0c, // return base template iteration result
    
    SCTP_CMD_EVENT_CREATE:      0x0e, // create subscription to specified event
    SCTP_CMD_EVENT_DESTROY:     0x0f, // destroys specified event subscription
    SCTP_CMD_EVENT_EMIT:        0x10, // emits events to client

    SCTP_CMD_FIND_ELEMENT_BY_SYSITDF:   0xa0, // return sc-element by it system identifier
    SCTP_CMD_SET_SYSIDTF:       0xa1, // setup new system identifier for sc-element
    SCTP_CMD_STATISTICS:        0xa2, // return usage statistics from server
};


var SctpResultCode = {
    SCTP_RESULT_OK:                 0x00, 
    SCTP_RESULT_FAIL:               0x01, 
    SCTP_RESULT_ERROR_NO_ELEMENT:   0x02 // sc-element wasn't founded
}


var SctpIteratorType = {
    SCTP_ITERATOR_3F_A_A:       0,
    SCTP_ITERATOR_3A_A_F:       1,
    SCTP_ITERATOR_3F_A_F:       2,
    SCTP_ITERATOR_5F_A_A_A_F:   3,
    SCTP_ITERATOR_5_A_A_F_A_F:  4,
    SCTP_ITERATOR_5_F_A_F_A_F:  5,
    SCTP_ITERATOR_5_F_A_F_A_A:  6,
    SCTP_ITERATOR_5_F_A_A_A_A:  7,
    SCTP_ITERATOR_5_A_A_F_A_A:  8
}

var SctpEventType = {
    SC_EVENT_UNKNOWN:           -1,
    SC_EVENT_ADD_OUTPUT_ARC:     0,
    SC_EVENT_ADD_INPUT_ARC:      1,
    SC_EVENT_REMOVE_OUTPUT_ARC:  2,
    SC_EVENT_REMOVE_INPUT_ARC:   3,
    SC_EVENT_REMOVE_ELEMENT:     4
}

var sc_addr_size = 4;
var sctp_header_size = 10;

sc_addr_from_id = function(sc_id) {
    var a = sc_id.split("_");
    var seg = parseInt(a[0]);
    var offset = parseInt(a[1]);
    
    return (seg << 16) | offset;
}

sc_addr_to_id = function(addr) {
    return (addr & 0xFFFF).toString() + '_' + ((addr >> 16) & 0xFFFF).toString();
}

function SctpCommandBuffer(size) {
    var b, pos = 0,
        view = new DataView(new ArrayBuffer(size + sctp_header_size));
    
    return b = {
        
        writeUint8: function(v) {
            view.setUint8(pos, v, true);
            pos += 1;
        },
        
        writeUint32: function(v) {
            view.setUint32(pos, v, true);
            pos += 4;
        },
        
        writeBuffer: function(buff) {
            var dstU8 = new Uint8Array(view.buffer, pos);
            var srcU8 = new Uint8Array(buff);
            dstU8.set(srcU8);
            pos += buff.byteLength;
        },
        
        data: function() {
            return view.buffer;
        },
        
        setHeader: function(cmd, flags, id, size) {
            this.writeUint8(cmd);
            this.writeUint8(flags);
            this.writeUint32(id);
            this.writeUint32(size);
        }
    };
};

function SctpResultBuffer(v) {
    var view = v;
    
    return {
        
        getCmd: function() {
            return v.getUint8(0, true);
        },
        getId: function() {
            return v.getUint32(1, true);
        },
        getResultCode: function() {
            return v.getUint8(5, true);
        },
        getResultSize: function() {
            return v.getUint32(6, true);
        },
        getHeaderSize: function() {
            return sctp_header_size;
        },
        
        getResUint8: function(offset) {
            return view.getUint8(sctp_header_size + offset, true);
        },
        getResUint16: function(offset) {
            return view.getUint16(sctp_header_size + offset, true);
        },
        getResUint32: function(offset) {
            return view.getUint32(sctp_header_size + offset, true);
        }
    };
}

SctpClient = function() {
    this.socket = null;
    this.task_queue = [];
    this.task_timeout = 0;
    this.task_frequency = 10;
    this.events = {};
}

SctpClient.prototype.connect = function(url, success) {
    this.socket = new WebSocket('ws://' + window.location.host + '/sctp'/*, ['soap', 'xmpp']*/);
    this.socket.binaryType = 'arraybuffer';

    var self = this;
    this.socket.onopen = function() {
        console.log('Connected to websocket');
        success();
        
        var emit_events = function() {
            if (self.event_timeout != 0)
            {
                window.clearTimeout(self.event_timeout);
                self.event_timeout = 0;
            }
            
            self.event_emit();
            
            window.setTimeout(emit_events, 5000);
        };
        
        emit_events();
    };
    this.socket.onmessage = function(e) {
        console.log('message', e.data);
    };
    this.socket.onclose = function() {
        console.log('Closed websocket connection');
    };
    this.socket.onerror = function(e) {
        console.log('WebSocket Error ' + e);
    };
    
}


SctpClient.prototype._push_task = function(task) {
    this.task_queue.push(task);
    var self = this;
    
    function process() {
        var t = self.task_queue.shift();
        
        self.socket.onmessage = function(e) {
            
            var result = new SctpResultBuffer(new DataView(e.data));
            if (result.getResultSize() != e.data.byteLength - result.getHeaderSize())
                throw "Invalid data size " + l
            
            if (e && e.data && result.getResultCode() == SctpResultCode.SCTP_RESULT_OK) {
                t.dfd.resolve(t.parse ? t.parse(result) : result);
            } else
                t.dfd.reject();
            
            if (self.task_queue.length > 0)
                self.task_timeout = window.setTimeout(process, this.task_frequency)
            else
            {
                window.clearTimeout(self.task_timeout);
                self.task_timeout = 0;
            }
        }

        self.socket.send(t.message);
    }
    
    if (!this.task_timeout) {
        this.task_timeout = window.setTimeout(process, this.task_frequency)
    }
};

SctpClient.prototype.new_request = function(message, parseFn) {
    var dfd = new jQuery.Deferred();
    this._push_task({
        message: message,
        parse: parseFn,
        dfd: dfd
    });
    return dfd.promise();
};

SctpClient.prototype.erase_element = function(addr) {
    throw "Not supported";
};


SctpClient.prototype.check_element = function(addr) {
    throw "Not supported";
};


SctpClient.prototype.get_element_type = function(addr) {
    throw "Not supported";
};

SctpClient.prototype.get_arc = function(addr) {
    throw "Not supported";
};

SctpClient.prototype.create_node = function(type) {
   throw "Not supported";
};


SctpClient.prototype.create_arc = function(type, src, trg) {
    throw "Not supported";
};


SctpClient.prototype.create_link = function() {
    throw "Not supported";
};


SctpClient.prototype.set_link_content = function(addr, data) {
    throw "Not supported";
};


SctpClient.prototype.get_link_content = function(addr) {
    throw "Not supported";
};


SctpClient.prototype.find_links_with_content = function(data) {
    throw "Not implemented";
};


SctpClient.prototype.iterate_elements = function(iterator_type, args) {
    throw "Not supported";
};


SctpClient.prototype.find_element_by_system_identifier = function(data) {
    var buffData = String2ArrayBuffer(data);
    var buffer = new SctpCommandBuffer(buffData.byteLength + 4);
    buffer.setHeader(SctpCommandType.SCTP_CMD_FIND_ELEMENT_BY_SYSITDF, 0, 0, buffData.byteLength + 4);
    buffer.writeUint32(buffData.byteLength);
    buffer.writeBuffer(buffData);
    
    return this.new_request(buffer.data(), function(data) {
        return {
            resCode: data.getResultCode(),
            result: sc_addr_to_id(data.getResUint32(0))
        };
    });
};


SctpClient.prototype.set_system_identifier = function(addr, idtf) {
    throw "Not supported";
};

SctpClient.prototype.event_create = function(evt_type, addr, callback) {
   /* var dfd = new jQuery.Deferred();
    var self = this;
    this.new_request({
        cmdCode: SctpCommandType.SCTP_CMD_EVENT_CREATE,
        args: [evt_type, addr]
    }).done(function(data) {
        self.events[data.result] = callback;
        dfd.resolve(data);
    }).fail(function(data) {
        dfd.reject(data);
    });*/
    throw "Not supported";
    
    return dfd.promise();
};

SctpClient.prototype.event_destroy = function(evt_id) {
    /*var dfd = new jQuery.Deferred();
    var self = this;
    
    this.new_request({
        cmdCode: SctpCommandType.SCTP_CMD_EVENT_DESTROY,
        args: [evt_id]
    }).done(function(data) {
        delete self.event_emit[evt_id];
        dfd.promise(data.result);
    }).fail(function(data){ 
        dfd.reject(data);
    });*/
    throw "Not supported";
    
    return dfd.promise();
};

SctpClient.prototype.event_emit = function() {
    var dfd = new jQuery.Deferred();
    var self = this;
    
    var buffer = new SctpCommandBuffer(0);
    buffer.setHeader(SctpCommandType.SCTP_CMD_EVENT_EMIT, 0, 0, 0);
    
    this.new_request(buffer.data())
    .done(function (data) {
        var n = data.getResUint32(0);
        for (var i = 0; i < n; ++i) {
            evt_id = data.getResUint32(4 + i * 16);
            addr = data.getResUint32(8 + i * 16);
            arg = data.getResUint32(12 + i * 16);
            var func = self.events[evt_id];

            if (func)
                func(addr, arg);
        }
        dfd.resolve();
    }).fail(function(data) {
        dfd.reject();
    });;

    return dfd.promise();
};

SctpClient.prototype.get_statistics = function() {
    throw "Not implemented";
};

SctpClientCreate = function() {
    var dfd = jQuery.Deferred();
    
    var sctp_client = new SctpClient();
    sctp_client.connect('/sctp', function() {
        dfd.resolve(sctp_client);
    });
    
    return dfd.promise();
};