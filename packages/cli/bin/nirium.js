#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
// Nirium — Autonomous Agent CLI (v1.0.0)
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const program = new Command();

program
    .name('nirium')
    .description('Nirium protocol development tool')
    .version('1.0.0');

// --- COMMAND: create bot ---
program
    .command('create')
    .argument('<type>', 'What to create (bot, skill, kernel)')
    .option('-n, --name <name>', 'Name of the project', 'nirium-bot-v1')
    .option('-t, --template <template>', 'Language template (ts, py)', 'ts')
    .description('Scaffold a new Nirium project')
    .action(async (type, options) => {
        if (type !== 'bot') {
            console.error('❌ Error: Currently only "bot" creation is supported.');
            process.exit(1);
        }

        const targetDir = path.join(process.cwd(), options.name);

        if (fs.existsSync(targetDir)) {
            console.error(`❌ Error: Directory ${options.name} already exists.`);
            process.exit(1);
        }

        console.log(`\n🧬 [Scaffold] Creating ${options.template === 'ts' ? 'TypeScript' : 'Python'} bot: ${options.name}...`);

        fs.mkdirSync(targetDir, { recursive: true });

        if (options.template === 'ts') {
            scaffoldTS(targetDir, options.name);
        } else {
            scaffoldPY(targetDir, options.name);
        }

        console.log(`\n✅ Project initialized in ./${options.name}`);
        console.log(`\n🚀 Get started:`);
        console.log(`   cd ${options.name}`);
        if (options.template === 'ts') {
            console.log(`   npm install`);
            console.log(`   npm run dev`);
        } else {
            console.log(`   python -m venv venv`);
            console.log(`   source venv/bin/activate`);
            console.log(`   pip install -r requirements.txt`);
            console.log(`   python main.py`);
        }
    });

function scaffoldTS(dir, name) {
    const pkgJson = {
        name,
        version: '0.1.0',
        private: true,
        scripts: {
            "dev": "tsx watch src/index.ts",
            "build": "tsc"
        },
        dependencies: {
            "@nirium/sdk": "latest",
            "tsx": "^4.19.0",
            "typescript": "^5.7.0",
            "dotenv": "^16.4.5"
        }
    };

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
    fs.mkdirSync(path.join(dir, 'src'));

    const indexSrc = `
import { NiriumAgent } from '@nirium/sdk';
import 'dotenv/config';

const agent = new NiriumAgent({
  apiUrl: process.env.NIRIUM_API_URL || 'http://localhost:3001',
  apiKey: process.env.NIRIUM_API_KEY
});

agent.on('signal', (signal) => {
  console.log('🧬 [Signal Received]:', signal.type, signal.pair);
  // Logic to execute on signals...
});

agent.on('connected', () => {
  console.log('✅ Connected to Nirium Neural Loop');
});

agent.connect();
`;
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), indexSrc);
    fs.writeFileSync(path.join(dir, '.env'), 'NIRIUM_API_URL=http://localhost:3001\nNIRIUM_API_KEY=');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: "es2022",
            module: "nodenext",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true
        }
    }, null, 2));
}

function scaffoldPY(dir, name) {
    const reqs = "nirium-sdk>=1.0.0\npython-dotenv>=1.0.0";
    fs.writeFileSync(path.join(dir, 'requirements.txt'), reqs);

    const mainSrc = `
import asyncio
import os
from nirium.client import NiriumAgent
from dotenv import load_dotenv

load_dotenv()

async def main():
    agent = NiriumAgent(
        api_url=os.getenv("NIRIUM_API_URL", "http://localhost:3001"),
        api_key=os.getenv("NIRIUM_API_KEY")
    )

    @agent.on("signal")
    async def handle_signal(signal):
        print(f"🧬 [Signal]: {signal['type']} on {signal['pair']}")

    @agent.on("connected")
    async def on_connect(data):
        print("✅ Connected to Nirium Neural Loop")

    await agent.connect()

if __name__ == "__main__":
    asyncio.run(main())
`;
    fs.writeFileSync(path.join(dir, 'main.py'), mainSrc);
    fs.writeFileSync(path.join(dir, '.env'), 'NIRIUM_API_URL=http://localhost:3001\nNIRIUM_API_KEY=');
}

program.parse();
