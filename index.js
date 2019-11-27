/**
 *   understand/
 * Facebook messenger channel purely for support channel.
 * These messages will directly communicate with the KB service.
 * If the KB answer not found, message forward to the owner through any one of the channels.
 * Default support channel is Qwert channel.
 * User can change the support channel by using command /use_for_support telegram.
 *
**/

'use strict'
const u = require('@elife/utils')
const keymapper = require('@elife/utils/keymapper')
const cote = require('cote')({ statusLogsEnabled: false })
const request = require('request')

/*      understand/
 * This is the main entry point where we start.
 *
 *      outcome/
 * Load any configuration information, set up the communication channels
 * with the comm manager, and start the bot.
 */

let cfg
let authChallenge
let pollReq = {
  intervel: [5, 10, 15, 20, 30, 60, 600],
  reqTimeNdx: 0,
}

let channels = {
  "telegram": 'everlife-comm-telegram-svc',
  "qwert": 'everlife-comm-qwert-svc'
}

let channelHandler;

function main () {
  cfg = loadConfig()
  loadAuthChallenge()
  loadSupportChannel()
  registerWithCommMgr()
}

const levelDBClient = new cote.Requester({
  name: 'Facebook Messenger client',
  key: 'everlife-db-svc',
})

function loadSupportChannel() {
  levelDBClient.send({ type: 'get', key: 'SUPPORT-CHANNEL' }, (err,val) => {
      if(err || !val) {
        channelHandler = new cote.Requester({
          name: 'Facebook Messenger Client',
          key: 'everlife-comm-qwert-svc'
        })
      } else {
        channelHandler = new cote.Requester({
          name: 'Facebook Messenger Client',
          key: val
        })
      }
  })
}

const ssbClient = new cote.Requester({
  name: 'elife-fb-messenger -> SSB',
  key: 'everlife-ssb-svc'
})

/*      outcome/
 * Load the configuration (from environment variables) or default.
 */
function loadConfig () {
  let cfg = {}
  cfg.FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
  cfg.EVERLIFE_FB_SERVICE_GATEWAY =  process.env.EVERLIFE_FB_SERVICE_GATEWAY ? process.env.EVERLIFE_FB_SERVICE_GATEWAY : "https://fb.everlife.ai"
  return cfg
}

const botKey = 'everlife-comm-fb-msg-svc'

const botChannel = new cote.Responder({
  name: 'FB Messenger Communication Service',
  key: botKey
})

/**   /outcome
 *  Load the facebook page access token and
 * auth challange for everlife service gateway
 */
function loadAuthChallenge () {
  console.log('Loading auth challenge')
  ssbClient.send({ type: 'everlife-service-auth' }, (err, res) => {
    if (err) u.showErr(err)
    else {
      authChallenge = res
      pollMsg()
    }
  })
}

/**
 *  outcome /
 * To get a facebook messenger wehook config details to configure. 
 */
function sendFBConfigDetails(){
  let data =`Facebook messenger webhook - ${cfg.EVERLIFE_FB_SERVICE_GATEWAY}/${keymapper.toUrlSafeEd25519Key(authChallenge.key)}/webhook\n
  Verify token - ${authChallenge.signed}`
  sendReply(data,{ USELASTCHAN: true })
}

const communicationClient = new cote.Requester({
  name: 'FB Messenger Comm Channel',
  key: 'everlife-communication-svc'
})

/**
 * Get the answer from KB service.
 * If answer not found forward message to owner of the avatar 
 * through any one of the channels
 */

botChannel.on('reply', (req, cb) => {
  let addl = {}
  addl = req.addl
  if(addl && addl.type && addl.type == 'not-owner-message' && !(addl.ans)){
    forwardMsgToOwner(cfg, req)
  } else {
    sendMsgToFBMessenger(cfg, req.ctx, req.msg)
  }
})


function forwardMsgToOwner(cfg, req) {

    getUserDetails(cfg, req.ctx, (err, username) => {
      let msg
      if(err) msg = `You got message from ${req.ctx}: \n ${req.addl.msg}`
      else msg = `You got message from ${username} <${req.ctx}> :\n ${req.addl.msg}`
      channelHandler.send({ type: 'support-msg', msg: msg})
    })
}

/**
 *      outcome/
 * /fbwebhookinfor
 *    This command used to get the facebook webhook config details. 
 * like: verify token and webhook URL
 * 
 * /tell <fb-user-id> <message>
 *   This command used to respond to the customer query.
 * 
 * /use_for_support
 *     This command used to change the support channel to get the support messages.
 */

botChannel.on('msg', (req, cb) => {

  if(!req.msg) return cb()
  if(req.msg.startsWith('/fbwebhookinfo')) {
    cb(null, true)
    sendFBConfigDetails()
  } else if(req.msg.startsWith('/tell')) {

    let msg = req.msg.substr('/tell '.length)
    msg = msg.trim()
    let p = msg.indexOf(" ")
    if(p < 1) return cb()
    let userID = msg.substr(0, p)
    let userMsg = msg.substr(p+1)
    cb(null, true)
    sendMsgToFBMessenger(cfg, userID, userMsg)

  } else if(req.msg.startsWith('/use_for_support')){

    let msg = req.msg.substr('/use_for_support'.length)
    let channel = channels[msg.trim().toLowerCase()]
    cb(null, true)
    if(!channel){
      sendReply('Invalid Channel. Please try any one of this channel \ntelegram \nqwert', req)
    } else {
      levelDBClient.send({ type: 'put', key: channel, val: val }, (err) => {
        if(err) console.log(err)
      })
      channelHandler = new cote.Requester({
        name: 'Facebook Messenger channel',
        key: channel
      })
      sendReply(`Changed support channel to ${msg}.`, req)
    }

  } else cb()
})

/**
 *   understand /
 * This will make a request to FB messagener gateway to get all the available message.
 * If we get any response or any connection broken we will make another request.
 * 
 */

function pollMsg () {
  if (!cfg.EVERLIFE_FB_SERVICE_GATEWAY) console.log('Please add everlife service gateway..')
  else if (!authChallenge) console.log('Auth challenge is missing for everlife service gateway.')
  else {
    let options = {
      'auth': {
        'user': authChallenge.key,
        'password': authChallenge.signed,
        'sendImmediately': true
      }
    }
    options['uri'] = `${cfg.EVERLIFE_FB_SERVICE_GATEWAY}/${keymapper.toUrlSafeEd25519Key(authChallenge.key)}/msg`
    options['method'] = 'GET'
    request(options, (err, response, body) => {
      if (err) {
        u.showErr(err)
        pollReq['error'] = err
      }
      else {
        pollReq['res'] = response
        try {
          let res = JSON.parse(response.body)
          if (Array.isArray(res)) {
            for (let i = 0; i < res.length; i++) {
              sendMsgToCommChannel(res[i])
            }
          }
        } catch (e) {
          console.error(e)
        }
      }
      pollMsgIntervel()
    })
  }
}

/**
 *  problem/
 *    If given fb-messenger-gateway is down, this will make a continus request.
 * In this case this process will consume more power and memory.
 *  
 *  way/
 *    If facebook messenger gateway is down, his will make a request certain intervel.
 * intervals are 5, 10, 15, 20, 25 and 30 seconds else we will poll a message immediately. 
 *
 */
function pollMsgIntervel(){
  if(pollReq.error ||
    (pollMsg.res && !(''+pollReq.res.statusCode).match(/^2\d\d$/))
      && pollReq.res.statusCode+''!=='502') {
    setTimeout(() => {
      pollMsg()
    }, pollReq.intervel[pollReq.reqTimeNdx] * 1000)
    if(pollReq.reqTimeNdx < pollReq.intervel.length) pollReq.reqTimeNdx++
  } else {
    pollReq['reqTimeNdx'] = 0
    pollMsg()
  }
  pollReq['error'] = null
  pollReq['res'] = null
}

/**
 * Send a message to communication channel to process the message
 * 
 */
function sendMsgToCommChannel (data) {
  let opts = {
    chan: botKey,
    ctx: data.sender.id,
    from: data.sender.id,
    msg: data.message.text,
    type: 'not-owner-message'
  }

  communicationClient.send(opts, (err) => {
    if (err) {
      u.showErr(err)
    }
  })
}

/**
 *    outcome/
 * Send a avatar reply to specific facebook messenger user
 */

function sendMsgToFBMessenger (cfg, userID, msg) {
  if (!cfg.FACEBOOK_PAGE_ACCESS_TOKEN && !userID) return

  const messageData = { recipient: { id: userID }, message: { text: msg } }

  request({
    uri: 'https://graph.facebook.com/v4.0/me/messages',
    qs: {
      access_token: cfg.FACEBOOK_PAGE_ACCESS_TOKEN
    },
    method: 'POST',
    json: messageData
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      console.log('Message sent successfully.')
    } else {
      console.error('Send message failed.')
    }
  })
}

/**
 *   outcome/
 * Get the user firstname and lastname from facebook 
 */
function getUserDetails(cfg, userID, cb){

  if (!cfg.FACEBOOK_PAGE_ACCESS_TOKEN || !userID) return
  request({
    uri: `https://graph.facebook.com/v4.0/${userID}`,
    qs: {
      access_token: cfg.FACEBOOK_PAGE_ACCESS_TOKEN
    },
    method: 'GET'
  }, function (error, response, body) {
    if(error) cb(error)
    else {
      body = JSON.parse(body)
      cb(null , `${body.first_name} ${body.last_name}`)
    }
  })
}

function sendReply(msg, req) {
  req.type = 'reply'
  req.msg = String(msg)
  communicationClient.send(req, (err) => {
      if(err){
          u.showErr(err)
      }
  })
}

function registerWithCommMgr() {
  communicationClient.send({
      type: 'register-msg-handler',
      mskey: botKey,
      mstype: 'msg',
      mshelp: [ 
          {cmd: '/fbwebhookinfo', txt: 'Get facebook messenger webhook config details' },
          {cmd: '/use_for_support <channel-name>', txt: 'Get the messenger message in a specific channel, like: telegram,qwert'},
          {cmd: '/tell <chat-id> <reply-msg>', txt: 'Reply to the messenger channel user.'}
          
      ],
  }, (err) => {
      if(err) u.showErr(err)
  })
}

main()
