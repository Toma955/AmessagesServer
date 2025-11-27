require('dotenv').config();

function getConfig() {
    return {
        PORT: process.env.PORT || 3000,
        NODE_ENV: process.env.NODE_ENV || 'development',
    };
}

module.exports = { getConfig };
