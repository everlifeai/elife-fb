'use strict'
const u = require('elife-utils')
const keymapper = require('elife-utils/keymapper')
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

function main () {
  cfg = loadConfig()
  loadAuthChallenge()
  registerWithCommMgr()
}

const ssbClient = new cote.Requester({
  name: 'elife-fb-messenger -> SSB',
  key: 'everlife-ssb-svc'
})

/*      outcome/
 * Load the configuration (from environment variables) or defaults
 */
function loadConfig () {
  let cfg = {}
  cfg.FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
  cfg.EVERLIFE_FB_SERVICE_GATEWAY =  process.env.EVERLIFE_FB_SERVICE_GATEWAY ? process.env.EVERLIFE_FB_SERVICE_GATEWAY : "https://6c433a81.ngrok.io"
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
function sendFBConfigDetails(){
  let data =`Facebook messenger webhook - ${cfg.EVERLIFE_FB_SERVICE_GATEWAY}/${keymapper.toUrlSafeEd25519Key(authChallenge.key)}/webhook\n
  Verify token - ${authChallenge.signed}`
  console.log(data)
  sendReply(data,{ USELASTCHAN: true })
}
const communicationClient = new cote.Requester({
  name: 'FB Messenger Comm Channel',
  key: 'everlife-communication-svc'
})

botChannel.on('reply', (req, cb) => {
  sendMsgToFBMessenger(cfg, req)
})
botChannel.on('msg', (req, cb) => {
  if(!req.msg) return cb()
  if(req.msg.startsWith('/fbwebhookinfo')){
    cb(null, true)
    sendFBConfigDetails()
  } else cb()
})
/**
 * TODO: Right now polling the message continuesly, need to find a better solution
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
      if (err) console.error(JSON.stringify(err))
      else {
        try {
          let res = JSON.parse(response.body)
          if (Array.isArray(res)) {
            for (let i = 0; i < res.length; i++) {
              sendMsgToCommChannel(res[i])
            }
          }
        } catch (e) {
          console.error(JSON.stringify(e))
        }
      }
      pollMsg()
    })
  }
}
/**
 * Send a message to communication channel to process the message
 */
function sendMsgToCommChannel (data) {
  let opts = {
    chan: botKey,
    ctx: data.sender.id,
    from: data.sender.id,
    msg: data.message.text,
    type: 'message'
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

function sendMsgToFBMessenger (cfg, req) {
  if (!cfg.FACEBOOK_PAGE_ACCESS_TOKEN) return

  const messageData = { recipient: { id: req.ctx }, message: { text: req.msg } }

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
          
      ],
  }, (err) => {
      if(err) u.showErr(err)
  })
}

main()
