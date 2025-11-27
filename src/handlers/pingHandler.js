function handlePing(ws, _msg) {
    ws.send(JSON.stringify({ t: 'pong', alive: true }));
}

module.exports = { handlePing };
