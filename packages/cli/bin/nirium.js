#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
// Nirium — Autonomous Agent CLI (v1.0.1)
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
    .version('1.0.1');

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
            "nirium": "^0.6.2",
            "tsx": "^4.19.0",
            "typescript": "^5.7.0",
            "dotenv": "^16.4.5"
        },
        devDependencies: {
            "@types/node": "^20.19.0"
        }
    };

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
    fs.mkdirSync(path.join(dir, 'src'));

    const indexSrc = `
import { Agent } from 'nirium';
import 'dotenv/config';

const agent = new Agent({
  baseUrl: process.env.NIRIUM_API_URL || 'http://localhost:3001',
  apiKey: process.env.NIRIUM_API_KEY
});

agent.subscribe((signal) => {
  console.log('🧬 [Signal Received]:', signal.signal_type, signal.pair);
  // Logic to execute on signals...
});

console.log('✅ Listening for Nirium signals...');
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
    const reqs = "nirium>=0.6.2\npython-dotenv>=1.0.0";
    fs.writeFileSync(path.join(dir, 'requirements.txt'), reqs);

    const mainSrc = `
import asyncio
import os
from nirium import Agent
from dotenv import load_dotenv

load_dotenv()

async def main():
    agent = Agent(
        api_url=os.getenv("NIRIUM_API_URL", "http://localhost:3001"),
        api_key=os.getenv("NIRIUM_API_KEY")
    )

    @agent.on("signal")
    async def handle_signal(signal):
        print(f"🧬 [Signal]: {signal['signal_type']} on {signal['pair']}")

    @agent.on("connected")
    async def on_connect(data):
        print("✅ Connected to Nirium Neural Loop")

    await agent.subscribe()

if __name__ == "__main__":
    asyncio.run(main())
`;
    fs.writeFileSync(path.join(dir, 'main.py'), mainSrc);
    fs.writeFileSync(path.join(dir, '.env'), 'NIRIUM_API_URL=http://localhost:3001\nNIRIUM_API_KEY=');
}

program.parse();
