// ═══════════════════════════════════════════════════════════════
// Nirium CLI — Project Scaffolding Tool
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
    .name('nirium')
    .description('🧬 Nirium CLI — Scaffolding tool for autonomous DeFi bots')
    .version('0.1.0');

program
    .command('create')
    .description('Create a new Nirium bot project')
    .argument('<name>', 'Project name')
    .option('-l, --language <lang>', 'Language: ts (TypeScript) or py (Python)', 'ts')
    .option('-k, --api-key <key>', 'Nirium API key')
    .option('-u, --url <url>', 'Agent URL', 'http://localhost:3001')
    .action((name: string, options: { language: string; apiKey?: string; url: string }) => {
        const targetDir = path.resolve(process.cwd(), name);

        if (fs.existsSync(targetDir)) {
            console.error(`❌ Directory "${name}" already exists.`);
            process.exit(1);
        }

        console.log(`\n🧬 Creating Nirium ${options.language.toUpperCase()} bot: ${name}\n`);

        fs.mkdirSync(targetDir, { recursive: true });

        if (options.language === 'py') {
            createPythonProject(targetDir, name, options);
        } else {
            createTypeScriptProject(targetDir, name, options);
        }

        console.log(`\n✅ Project created at ./${name}`);
        console.log(`\n📋 Next steps:`);

        if (options.language === 'py') {
            console.log(`   cd ${name}`);
            console.log(`   pip install -r requirements.txt`);
            console.log(`   python main.py`);
        } else {
            console.log(`   cd ${name}`);
            console.log(`   pnpm install`);
            console.log(`   pnpm dev`);
        }

        console.log('');
    });

program
    .command('status')
    .description('Check agent connection status')
    .option('-u, --url <url>', 'Agent URL', 'http://localhost:3001')
    .action(async (options: { url: string }) => {
        try {
            const response = await fetch(`${options.url}/health`);
            if (response.ok) {
                const data = await response.json() as Record<string, unknown>;
                console.log('🟢 Agent is operational');
                console.log(`   Version: ${data.version}`);
                console.log(`   Network: ${data.network}`);
                console.log(`   Uptime:  ${data.uptime}s`);
            } else {
                console.log('🔴 Agent returned error:', response.status);
            }
        } catch {
            console.log('🔴 Agent unreachable at', options.url);
        }
    });

function createTypeScriptProject(dir: string, name: string, options: { apiKey?: string; url: string }): void {
    // package.json
    const pkg = {
        name,
        version: '1.0.0',
        type: 'module',
        scripts: {
            dev: 'tsx watch index.ts',
            build: 'tsc',
            start: 'node dist/index.js',
        },
        dependencies: {
            'nirium': '^0.6.1',
        },
        devDependencies: {
            tsx: '^4.19.0',
            typescript: '^5.7.0',
        },
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

    // tsconfig.json
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            outDir: './dist',
        },
        include: ['*.ts'],
    };
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

    // index.ts
    const apiKey = options.apiKey || 'YOUR_API_KEY';
    const indexTs = `// ═══════════════════════════════════════════════════
// ${name} — Nirium Autonomous Bot
// ═══════════════════════════════════════════════════

import { Agent } from 'nirium';

const agent = new Agent({
  apiKey: '${apiKey}',
  baseUrl: '${options.url}',
});

async function main() {
  console.log('🧬 Starting ${name}...');

  // Check agent health
  const alive = await agent.ping();
  console.log('Agent alive:', alive);

  if (!alive) {
    console.error('❌ Agent unreachable. Make sure it is running.');
    process.exit(1);
  }

  // Get market data (real from Horizon)
  const market = await agent.getMarket();
  console.log(\`📊 XLM Price: \$\${market.xlmPrice.toFixed(4)}\`);
  console.log(\`⚡ Base Fee: \${market.baseFee} stroops\`);
  console.log(\`📉 SDEX Spread: \${market.sdexSpread.toFixed(1)} bps\`);

  // Start the autonomous loop
  const loopResult = await agent.startLoop({
    minProfitPercentage: 0.3,
    maxBaseFee: 500,
  });
  console.log('🚀 Loop:', loopResult.message);

  // Subscribe to real-time signals
  agent.subscribe((signal) => {
    console.log(\`\\n⚡ SIGNAL: \${signal.signal_type}\`);
    console.log(\`   Pair: \${signal.pair}\`);
    console.log(\`   Confidence: \${(signal.data.confidence * 100).toFixed(0)}%\`);
    console.log(\`   Details: \${signal.data.details}\`);

    // Auto-execute high-confidence opportunities
    if (signal.data.confidence > 0.75 && signal.signal_type === 'path_arbitrage_opportunity') {
      console.log('🎯 High confidence path arbitrage detected! Executing...');
      agent.execute('path-arbitrage', 'XLM-USDC', { amount: 1000 })
        .then(result => {
          if (result.success) {
            console.log(\`✅ Profit: +\${result.profit} stroops\`);
          } else {
            console.log(\`❌ Execution failed: \${result.error}\`);
          }
        })
        .catch(err => console.error('Execution error:', err));
    }
  });

  console.log('\\n👁️ Listening for signals... Press Ctrl+C to stop.');
}

main().catch(console.error);
`;
    fs.writeFileSync(path.join(dir, 'index.ts'), indexTs);

    console.log('  📄 package.json');
    console.log('  📄 tsconfig.json');
    console.log('  📄 index.ts');
}

function createPythonProject(dir: string, name: string, options: { apiKey?: string; url: string }): void {
    // requirements.txt
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'nirium>=0.1.0\nrequests>=2.32.0\nwebsockets>=13.0\n');

    // main.py
    const apiKey = options.apiKey || 'YOUR_API_KEY';
    const mainPy = `#!/usr/bin/env python3
"""${name} — Nirium Autonomous Bot"""

import asyncio
from nirium import Agent

agent = Agent(
    api_key="${apiKey}",
    base_url="${options.url}",
)


def on_signal(signal: dict) -> None:
    """Handle incoming signals."""
    print(f"\\n⚡ SIGNAL: {signal.get('signal_type')}")
    print(f"   Pair: {signal.get('pair')}")
    print(f"   Confidence: {signal.get('data', {}).get('confidence', 0) * 100:.0f}%")
    print(f"   Details: {signal.get('data', {}).get('details')}")

    # Auto-execute high-confidence opportunities
    confidence = signal.get("data", {}).get("confidence", 0)
    if confidence > 0.75 and signal.get("signal_type") == "path_arbitrage_opportunity":
        print("🎯 High confidence path arbitrage! Executing...")
        result = agent.execute("path-arbitrage", "XLM-USDC", {"amount": 1000})
        if result.get("success"):
            print(f"✅ Profit: +{result.get('profit', 0)} stroops")
        else:
            print(f"❌ Failed: {result.get('error')}")


async def main():
    print("🧬 Starting ${name}...")

    # Health check
    alive = agent.ping()
    print(f"Agent alive: {alive}")

    if not alive:
        print("❌ Agent unreachable.")
        return

    # Market data
    market = agent.get_market()
    print(f"📊 XLM Price: \${market['xlmPrice']:.4f}")
    print(f"⚡ Base Fee: {market['baseFee']} stroops")

    # Start loop
    result = agent.start_loop({"minProfitPercentage": 0.3})
    print(f"🚀 Loop: {result['message']}")

    # Subscribe to signals
    print("\\n👁️ Listening for signals... Press Ctrl+C to stop.")
    await agent.subscribe(on_signal)


if __name__ == "__main__":
    asyncio.run(main())
`;
    fs.writeFileSync(path.join(dir, 'main.py'), mainPy);

    console.log('  📄 requirements.txt');
    console.log('  📄 main.py');
}

program.parse();
