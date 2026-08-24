from setuptools import setup, find_packages

setup(
    name="nirium",
    version="0.9.0",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        "websockets>=13.0",
        "aiohttp>=3.9.0",
        "stellar-sdk>=11.0.0",
    ],
    extras_require={
        "test": [
            "pytest>=8.0.0",
            "pytest-asyncio>=0.23.0",
        ],
    },
    author="Nirium Team",
    description="Official Python SDK for Nirium autonomous agents on Stellar (x402 + MPP)",
    keywords=["nirium", "stellar", "defi", "x402", "mpp", "agentic-payments", "soroban"],
    python_requires=">=3.10",
)
