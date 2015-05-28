var config = require('./config');

/*
 * Google API stuff, creating session and such.
 */
var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var OAuth2Client = google.auth.OAuth2;
var mail = google.gmail('v1');

var oauth2Client;

var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'gmail_api_token.json';

// Load client secrets from a local file.
fs.readFile('client_secret.json', function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the Calendar API.
  authorize(JSON.parse(content), function(oauth2Client) {console.log('Authentication completed');});
});

function authorize(credentials, callback) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getAccessToken(oauth2Client, callback);
    } else {
      oauth2Client.setCredentials(JSON.parse(token));
      callback(oauth2Client);
    }
  });
}

function getAccessToken(oauth2Client, callback) {

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/gmail.readonly'
  });

  console.log('Visit the url: ', url);
  rl.question('Enter the code here:', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, tokens) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.setCredentials(tokens);
      storeToken(tokens);
      callback();
    });
  });
}

function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

var builds = [];
var count = -1;
function getSVMXVersions(bot, trigger) {
  mail.users.messages.list({ userId: 'me', auth: oauth2Client, labelIds: 'Label_8' }, function(err, response) {
    if (err) {
      console.log('An error occured', err);
      return;
    }

    // Reset build list
    builds = [];

    var parseData = function(err, response) {
      if (err) {
        console.error(err);
        return;
      }
      for (var i=0; i<response.payload.headers.length; i++) {
        var header = response.payload.headers[i];
        if (header.name.toLowerCase() === 'subject') {
          builds.push(header.value);
        }
      }
      count--;
      if (count === 0) {
        buildslist = {};
        builds.reverse();
        for (var k=0; k<builds.length; k++) {
          build = builds[k];
          build = build.split('Build Notification: ', 2)[1];
          var array = build.split(', '),
              build = array[0], ver = array[1];
          if (ver.indexOf('\\') >= 0) {
            ver = ver.split('\\', 2)[0];
          }
          if (buildslist[build] === undefined || ver.localeCompare(buildslist[build]) > 0)
            buildslist[build] = ver;
        }
        var fmtlist = [];

        for (var v=0; v<Object.keys(buildslist).length; v++) {
          var key = Object.keys(buildslist)[v];
          var value = buildslist[key];
          fmtlist.push('*'+key+'*, '+value);
        }

        fmtlist.sort();

        bot.sendMessage(trigger.channel, fmtlist.join('\n'));
      }
    };
    count = response.messages.length;
    for (var i=0; i<response.messages.length; i++) {
      var email = response.messages[i];
      mail.users.messages.get({userId: 'me', auth: oauth2Client, id: email.id, format: 'metadata', metadataHeaders: 'Subject'}, parseData);
    }
  });
}

/*
 * Slack RTM stuff
 */

var slackbot = require('node-slackbot');
var bot = new slackbot(config.slack_api_key);

bot.use(function(message, cb) {
  if ('message' == message.type) {
    console.log(message.user + ' said: ' + message.text);
    if (message.text.indexOf('?builds') === 0) {
      getSVMXVersions(bot, message);
    }
  }
  cb();
});

bot.connect();
