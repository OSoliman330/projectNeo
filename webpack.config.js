const path = require('path');

const webviewConfig = {
    name: 'webview',
    mode: 'development',
    entry: './src/webview/index.tsx',
    target: 'web',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'webview.js',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
    },
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader', 'postcss-loader'],
            },
        ],
    },
    devtool: 'source-map',
};

const extensionConfig = {
    name: 'extension',
    mode: 'development',
    entry: './src/extension/extension.ts',
    target: 'node',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
        ],
    },
    externals: {
        vscode: 'commonjs vscode',
        '@google/genai': 'commonjs @google/genai',
        'google-auth-library': 'commonjs google-auth-library',
    },
    devtool: 'source-map',
};

module.exports = [webviewConfig, extensionConfig];
