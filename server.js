/* 

Organizing requests:
M - Make
U - Update
D - Delete
S - Share (other)
---
G - Get

*/

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const storage = require('./modules/storage');
const encrypt = require('./modules/cryptCompare');
const server = express();
const jwt = require('./modules/jwt');
const { CLIENT_RENEG_LIMIT } = require('tls');
//const { decodeToken } = require('./modules/jwt');

server.use(bodyParser.json({ limit: '50mb' }));
server.use(express.static('public'));

const credentials = require('./localenv').DATABASE_URL || process.env.DATABASE_URL;
const secret = require('./localenv').HASH_SECRET || process.env.HASH_SECRET;
const db = new storage(credentials);

/* **************** MIDDLEWARE ************************** */
const authenticator = async (req, res, next) => {
    //Basic http authentication for login
    //console.log('Authenticating....');

    //If no authorization header:
    if (!req.headers.authorization || req.headers.authorization.indexOf('Basic ') === -1) {
        return res.append("WWW-Authenticate", 'Basic realm="User Visible Realm", charset="UTF-8"').status(401).end();
    }

    const credentials = req.headers.authorization.split(' ')[1];
    const [usernameENC, passwordENC] = Buffer.from(credentials, 'base64').toString('UTF-8').split(":");
    const username = Buffer.from(usernameENC,'base64').toString('UTF-8');
    const password = Buffer.from(passwordENC,'base64').toString('UTF-8');
    
    //Retrieve username and password from database
    let passwordFromDB;
    console.log(username, password);
    if (username) {
        let data = await db.getUser(username);
        console.log('Data:');
        console.log(data);
        if (data === undefined) {
            console.log('User does not exist');
            //req.login = false;
            return next();
        } else {
            passwordFromDB = data.password;
        }
    }

    //If password OK - login = ok
    if (encrypt.comparePasswords(encrypt.encryptPassword(password), passwordFromDB)) {
        req.user = username;
        req.login = true;
        next();
    } else {
        req.login = false;
        next();
    }
}

const authorizer = async (req, res, next) => {
    //If no authorization header:
    //console.log('Authorizing....');
    if (!req.headers.authorization || req.headers.authorization.indexOf('Bearer ') === -1) {
        return res.append("WWW-Authenticate", 'Bearer realm="User Visible Realm", charset="UTF-8"').status(401).end();
    }

    //Verify token
    let token = req.headers.authorization.split(' ')[1];
    let valid = jwt.validateToken(token);

    //If validation => next()
    if (valid) {
        console.log('Authorized');
        req.authorized = true;
        req.token = token;
        next();
    } else {
        console.log('Unauthorized');
        res.status(401).end();
    }
}
/* ****************************************** */

/* BASIC AUTHENTICATION FOR LOGIN */
server.post('/api/login', authenticator, async (req, res) => {
    if (req.login) {
        //If login successful - generate token to send along
        let token = jwt.generateToken({ username: req.user });
        res.status(200).json(token);
    } else {
        res.status(403).end();
    }
});

/* AVAILABLE WITHOUT FULL AUTHORIZATION OR AUTHENTICATION */
server.post('/api/logout', (req, res)=>{
    res.status(401).end();
});

server.post('/api/makeUser', async (req, res) => {

    let username = req.body.username;
    let password = req.body.password;

    //Validation
    if(username.length === 0 || password.length === 0){
        res.status(200).json('VAL0').end();
        return;
    }

    /* if(username.includes(':') || password.includes(':')){
        res.status(200).json('VAL1').end();
    } */

    //Hash password
    password = encrypt.encryptPassword(password);

    //Send info to database
    let result = await db.addUser(username, password);

    res.status(200).json(result).end();
});

/* CONDITIONAL AUTHORIZATION */
server.get('/api/getSlides/:presentation_id', async (req, res) => {

    let shareState = await db.getShareState(req.params.presentation_id);
    
    if(shareState === false){
        console.log('Share state is undefined');
        res.status(404).end();
    }
    

    //1 is public, 0 is private
    if (shareState === 1) {
        console.log('public');
        let result = await db.getSlides(req.params.presentation_id);

        if (result) {
            res.status(200).json(result).end();
        } else {
            res.status(500).end();
        }
    } else if (shareState === 0) {
        //Require authorization
        authorizer(req, res, async () => {
            if (req.authorized) {
                let result = await db.getSlides(req.params.presentation_id);

                if (result) {
                    res.status(200).json(result).end();
                } else {
                    res.status(500).end();
                }

            } else {
                res.status(403).end();
            }
        });
    }
});

/* REQUIRES AUTHORIZATION */
server.use(authorizer);

//Users
server.post('/api/changePassword', async (req, res)=>{
    if(req.authorized){
        let newPassword = encrypt.encryptPassword(req.headers.authorization.split(' ')[2]);
        let username = jwt.decodeToken(req.token).username;
        
        let result = db.updatePassword(newPassword, username);
        if(result){
            res.status(200).json('Success').end();
        } else {
            res.status(500).json('Failed').end();
        }
    }
});


server.post('/api/updateUser', async (req, res) => {


    res.status(200).json(response).end();
});

server.get('/api/deleteUser', async (req, res) => {
    if(req.authorized){
        let decodedPayload = jwt.decodeToken(req.token);
        
        let username = decodedPayload.username;

        let result = await db.deleteUser(username)
        if(result){
            res.status(200).end();
        } else {
            res.status(500).end();
        }

    }
});

server.get('/api/validUsername', async (req, res) => {
    if(req.authorized){
    
        let decodedPayload = jwt.decodeToken(req.token);
        let username = decodedPayload.username;
        
        res.status(200).json({ username: username }).end();
    }
});

//Presentations

server.post('/api/makePresentation', async (req, res) => {

    //Får inn i body: et JSON-objekt som inneholder tittel på presentasjonen
    let title = req.body.title;

    let presentation = {
        title: title,
        share: req.body.share,
        slides: []
    }

    if (req.authorized) {
        let decodedPayload = jwt.decodeToken(req.token);
        let username = decodedPayload.username;

        let id = await db.addPresentation(username, presentation);

        if (id) {
            res.status(200).json({ id: id }).end();
        } else {
            res.status(500).end();
        }
    }

});

server.post('/api/editTitle', async (req, res)=>{
    if(req.authorized){
        let id = req.body.id;
        let newTitle = req.body.newTitle;

        let result = await db.editTitle(newTitle, id);
        if(result){
            res.status(200).json('Success').end();
        } else {
            res.status(500).json('Failed').end();
        }
    }
})

server.post('/api/updatePresentation', async (req, res) => {


    res.status(200).json(response).end();
});

server.post('/api/deletePresentation', async (req, res) => {
    //Får inn et token i header, som inneholder brukernavn i payloaden

    if (req.authorized) {
        let result = await db.deletePresentation(req.body.id);

        if (result) {
            res.status(200).end();
        } else {
            res.status(500).end();
        }
    }
});

server.post('/api/sharePresentation', async (req, res) => {
    //Must require presentation ID
    let id = req.body.id;
    let share = req.body.share;

    if(req.authorized){
        let result = await db.sharePresentation(id, share);
        if (result) {
            res.status(200).end();
        } else {
            res.status(500).end();
        }
    }
});

server.get('/api/getPresentations', async (req, res) => {
    if (req.authorized) {
        let decodedPayload = jwt.decodeToken(req.token);
        let username = decodedPayload.username;

        let result = await db.getPresentations(username);
        //console.log(result);

        if (result) {
            res.status(200).json(result).end();
        } else {
            res.status(500).end();
        }
    }
});

//Slides

server.post('/api/makeSlide', async (req, res) => {
    let presentation_id = req.body.presentation_id;
    let slide = req.body.slide;

    if (req.authorized) {
        let result = await db.createSlide(presentation_id, slide);

        if (result) {
            res.status(200).end();
        } else {
            res.status(500).end();
        }
    }
});

server.post('/api/updateSlide', async (req, res) => {

    if(req.authorized){
        let result = await db.updateSlide(req.body.presentationID, req.body.slide);
        if(result){
            res.status(200).end();
        }
    } else {
        res.status(403).end();
    }
    
});

server.post('/api/deleteSlide', async (req, res) => {
    if (req.authorized) {
        let result = await db.deleteSlide(req.body.presentation_id, req.body.slide_id);

        if (result) {
            res.status(200).json('slide deleted').end();
        } else {
            res.status(500).end();
        }
    } else {
        res.status(403).end();
    }
});

server.get('/api/getSlide/:presentationID/:slideID', async (req, res)=>{
    //console.log(req.params);
    if(req.authorized){
        let slide = await db.getSlide(req.params.presentationID, req.params.slideID);
        if(slide){
            res.status(200).json(slide).end();
        } else {
            res.status(500).end();
        }
    }
});


/* ************************************************ */
server.set('port', (process.env.PORT || 8080));
server.listen(server.get('port'), function () {
    console.log('server running', server.get('port'));

});