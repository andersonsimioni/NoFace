const peerjs = require("peerjs");
const crypto = require("crypto");
const crystalsKyberJs = require("crystals-kyber-js");
//const localStorage = new LocalStorage("localStorage");

class AES256
{
    constructor(key)
    {
        this.rawKey = key;
        this.key = undefined;
    }

    init = async () => 
    {
        this.key = await crypto.subtle.importKey(
            "raw",
            this.rawKey,
            { name: "AES-CBC", length: 256 }, 
            false, 
            ["encrypt", "decrypt"]
        );
    }

    encrypt = async (plainText) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(plainText);

        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: new Uint8Array(16) }, this.key, data
        );
        
        return Buffer.from(encrypted).toString("base64");
    }
    
    decrypt = async (encryptedData) => {
        let decoded = Buffer.from(encryptedData, "base64");
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: new Uint8Array(16) }, this.key, decoded
        );
    
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
}

class CryptoUser
{
    constructor(name)
    {
        this.ready = false;
        this.itemName = `${name}_keyPair`;
        this.localUser = new crystalsKyberJs.MlKem1024();
        this.pk = undefined;
        this.sk = undefined;
    }

    init = async  () =>
    {
        let [pk, sk] = await this.localUser.generateKeyPair(); 
        this.pk = pk;
        this.sk = sk;

        let keyPair = localStorage.getItem(this.itemName);
        if(keyPair == undefined || keyPair == '')
        {
            let json = JSON.stringify([Array.from(this.pk), Array.from(this.sk)]);
            localStorage.setItem(this.itemName, json);
        }
        else
        {
            let keyPairObj = JSON.parse(keyPair);
            this.pk = Uint8Array.from(keyPairObj[0]);
            this.sk = Uint8Array.from(keyPairObj[1]);
        }
    }

    getPkBase64 = () =>
    {
        return Buffer.from(this.pk).toString("base64");
    }

    encrypt = async (pkR, data) => 
    {
        let sender = new crystalsKyberJs.MlKem1024();
        let [aes256KeyCiphered, aes256Key] = await sender.encap(pkR);
        let aes = new AES256(aes256Key);
        await aes.init();
        let cipherText = await aes.encrypt(data);
        
        let cipherData = 
        [
            Buffer.from(aes256KeyCiphered).toString("base64"), 
            cipherText
        ];

        return JSON.stringify(cipherData);
    }

    decrypt = async (cipherData) => 
    {
        let decodedData = JSON.parse(cipherData);
        let aes256KeyCiphered = Uint8Array.from(Buffer.from(decodedData[0], "base64"));
        let cipherText = decodedData[1];

        let aes256Key = await this.localUser.decap(aes256KeyCiphered, this.sk);
        let aes = new AES256(aes256Key);
        await aes.init();
        let data = await aes.decrypt(cipherText);

        return data;
    }
}

class XorShiftRandom
{
    constructor(seed, offset)
    {
        this.seed = seed;
        if(offset != undefined) for (let i = 0; i < offset-1; i++) this.next();
    }

    next = (min, max) => 
    {
        let x = this.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        this.seed = x;
        if(min == undefined || max == undefined) return this.seed;

        return min + (x%(max-min));
    }
}

class P2pUser
{
    constructor(name)
    {
        let _this = this;
        this.seed = 666;
        this.maxOffset = 100;
        this.maxConnections = 20;
        this.name = name;
        this.connections = [];
        this.peer = this.generateLocalPeer();
        this.peer.on('connection', _conn => { _this.createConnectionRotine(_conn); });
        
        this.peerNetworkRotine();
        this.unknownPeerDiscoveryRotine();

        this.protocols = 
        {
            "/message": (data) => { _this.messageProtocol(data); },
            "/peerDiscovery": (data) => { _this.peerDiscoveryProtocol(data); },
        };

        this.onMessageCallbacks = [];
    }

    sleep = (ms) =>
    {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createConnectionRotine = (conn) => 
    {
        let _this = this;
        this.connections.push(conn);
        this.flushPeerList(conn);
        
        conn.on('data', data => { _this.onReceiveData(data); });
        conn.on('close', ()=>{ _this.connections.slice(_this.connections.indexOf(conn, 1)); });
    }

    flushPeerList = (conn) => 
    {
        let myPeerList = JSON.stringify(this.getPeersList());

        this.addOthersPeers(conn.peer);

        setTimeout(()=>{ conn.send(`/peerDiscovery${myPeerList}`); }, 1000);

        for (let i = 0; i < this.connections.length; i++) 
        {
            let newPeer = JSON.stringify([conn.peer]);
            this.connections[i].send(`/peerDiscovery${newPeer}`);
        }
    }

    unknownPeerDiscoveryRotine = ()=>
    {
        let offset = 1;
        let _this = this;
        setInterval(() => 
        {
            let rdPeer = _this.uuid(offset);
            if(_this.connections.filter(conn => conn.peer==rdPeer).length==0  && _this.peer.id!=rdPeer)
            {
                let conn = _this.peer.connect(rdPeer);
                if(conn == undefined) return;
                conn.on('open', () => { _this.createConnectionRotine(conn); });
            }

            offset = (offset+1)%_this.maxOffset;
        }, 5000);
    }

    peerNetworkRotine = ()=>
    {
        let _this = this;
        let connectionsCount = this.maxConnections;
        setInterval(() => 
        {
            if(_this.connections.length < connectionsCount)
            {
                let peerList = _this.getPeersList();
                peerList = Array.from(peerList).filter(x => _this.connections.filter(conn => conn.peer==x).length==0 && _this.peer.id!=x);
                if(peerList.length == 0) return;
                let rdPeer = peerList[parseInt(Math.random()*peerList.length)];
                let conn = _this.peer.connect(rdPeer);
                conn.on('open', () => { _this.createConnectionRotine(conn); });
            }
        }, 5000);
    }

    uuid = (offset) => {
        let rd = new XorShiftRandom(this.seed, offset);
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) 
        {
            var rdn = Math.abs(rd.next());
            var r = (rdn%16|0), v = c == 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    generateLocalPeer = () =>
    {
        let offset = Math.random()*this.maxOffset;
        let newPeerId = this.uuid(offset);
        let keyName = `${this.name}_localPeerId`;

        localStorage.setItem(keyName, newPeerId);
        this.peer = new peerjs.Peer(newPeerId);

        return this.peer;
    }

    getPeersList = () =>
    {
        let keyName = `${this.name}_othersPeers`;
        let aux = localStorage.getItem(keyName);
        if(aux == undefined || aux == '') return [];
        return JSON.parse(aux);
    }

    addOthersPeers = (peers) =>
    {
        let keyName = `${this.name}_othersPeers`;
        let peerList = this.getPeersList();
        Array(peers).forEach(p => { if(!peerList.includes(p) && this.peer.id!=p) peerList.push(p); });
        localStorage.setItem(keyName, JSON.stringify(peerList));
    }

    messageProtocol = (data) => 
    {
        for (let i = 0; i < this.onMessageCallbacks.length; i++) this.onMessageCallbacks[i](data);
    }

    addOnMessageCallback = (callback) =>
    {
        this.onMessageCallbacks.push(callback);
    }

    peerDiscoveryProtocol = (data) => 
    {
        let peers = JSON.parse(data);
        this.addOthersPeers(peers);
    }

    sendData = (data) => 
    {
        if(this.connections.length > 0)
        {
            let rdCon = this.connections[parseInt(this.connections.length*Math.random())];
            rdCon.send(data);
        }
    }

    onReceiveData = (data) =>
    {
        let ks = Object.keys(this.protocols);
        ks.forEach(k =>
        {
            if(String(data).startsWith(k)) this.protocols[k](String(data).substring(k.length));
        });
    }
}

class NoFaceUser
{
    constructor(name)
    {
        this.name = name;
        this.p2pUser = new P2pUser(name);
        this.cryptoUser = new CryptoUser(name);

        this.onMessageCallbacks = [];

        this.p2pUser.addOnMessageCallback(this.onReceive);
    }

    init = async () => 
    {
        await this.cryptoUser.init();
    };

    addOnMessageCallback = (callback) =>
    {
        this.onMessageCallbacks.push(callback);
    }

    onReceive = async (cipherData) =>
    {
        try
        {
            let text = await this.cryptoUser.decrypt(cipherData);
            let obj = JSON.parse(text);

            for (let i = 0; i < this.onMessageCallbacks.length; i++)
            {
                let encodedContact = Buffer.from(obj.contact).toString("base64");
                this.onMessageCallbacks[i](encodedContact, obj.data);
            }
        }
        catch{}
    }

    sendMessage = async (contact, data) =>
    {
        let contactDecoded = Uint8Array.from(Buffer.from(contact, "base64"));
        let selfContact = Buffer.from(this.cryptoUser.pk).toString("base64");
        let obj = { selfContact, data };
        let cipherObj = await this.cryptoUser.encrypt(contactDecoded, obj);

        this.p2pUser.sendData(cipherObj);
    }
}

window.peerjs = peerjs;
window.crypto = crypto;
window.crystalsKyberJs = crystalsKyberJs;
window.NoFaceUser = NoFaceUser;

//module.exports = NoFaceUser;

/* async function main(params) 
{
    let user1 = new P2pUser("user1");

}

main(); */