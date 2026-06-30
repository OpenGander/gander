"""
Promptfoo provider for OpenGander MCP Server tool calls.

This provider makes HTTP requests to the MCP server's tool endpoints
and returns the responses for evaluation by Promptfoo.

Usage in promptfoo tests:
    provider: python:providers/mcp_provider.py:call_tool

Environment Variables:
    MCP_ENDPOINT: Base URL of the MCP server (default: http://localhost:8000)
    MCP_TEST_API_KEY: Default API key for authentication

The provider expects test vars to include:
    - tool: Name of the MCP tool to call
    - args: (optional) Dictionary of arguments for the tool
    - api_key: (optional) Override the default API key
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx


def get_endpoint() -> str:
    """Get the MCP server endpoint from environment or config."""
    return os.environ.get("MCP_ENDPOINT", "http://localhost:8000")


def get_api_key(override: str | None = None) -> str:
    """
    Get the API key for authentication.

    Args:
        override: Optional override API key (from test vars)

    Returns:
        The API key to use for the request
    """
    if override:
        return override
    return os.environ.get("MCP_TEST_API_KEY", "")


async def call_tool(prompt: str, options: dict, context: dict) -> dict[str, Any]:
    """
    Promptfoo provider function for MCP tool calls.

    This function is called by Promptfoo for each test case. It extracts
    the tool name and arguments from the test variables and makes an
    HTTP request to the MCP server.

    Args:
        prompt: The prompt string (not used for MCP tool calls)
        options: Provider options including config
        context: Test context including variables

    Returns:
        Dictionary with 'output' key containing the tool response
    """
    # Get configuration
    config = options.get("config", {})
    endpoint = config.get("endpoint") or get_endpoint()

    # Get test variables
    vars_dict = context.get("vars", {})

    # Extract tool name and arguments
    tool_name = vars_dict.get("tool")
    if not tool_name:
        return {
            "output": json.dumps({"error": "No tool specified in test vars"}),
            "error": "Missing 'tool' in test variables"
        }

    # Get tool arguments (may be string or dict)
    tool_args = vars_dict.get("args", {})
    if isinstance(tool_args, str):
        try:
            tool_args = json.loads(tool_args)
        except json.JSONDecodeError:
            tool_args = {}

    # Get API key (may be overridden in test vars)
    api_key = get_api_key(vars_dict.get("api_key"))

    # Build request headers
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Build the MCP tool call request
    # FastMCP uses JSON-RPC style requests
    request_body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": tool_args
        }
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{endpoint}/mcp",
                headers=headers,
                json=request_body
            )

            # Check for HTTP-level errors
            if response.status_code == 401:
                return {
                    "output": json.dumps({
                        "error": "Unauthorized",
                        "status_code": 401,
                        "message": "Invalid or missing API key"
                    }),
                    "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
                }

            if response.status_code == 403:
                return {
                    "output": json.dumps({
                        "error": "Forbidden",
                        "status_code": 403,
                        "message": "Access denied"
                    }),
                    "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
                }

            if response.status_code >= 400:
                return {
                    "output": json.dumps({
                        "error": f"HTTP {response.status_code}",
                        "status_code": response.status_code,
                        "body": response.text
                    }),
                    "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
                }

            # Parse JSON-RPC response
            try:
                rpc_response = response.json()
            except json.JSONDecodeError:
                return {
                    "output": response.text,
                    "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
                }

            # Check for JSON-RPC error
            if "error" in rpc_response:
                return {
                    "output": json.dumps(rpc_response["error"]),
                    "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
                }

            # Extract the result
            result = rpc_response.get("result", rpc_response)

            # Handle content array format (MCP tool response format)
            if isinstance(result, dict) and "content" in result:
                content = result["content"]
                if isinstance(content, list) and len(content) > 0:
                    # Extract text from first content item
                    first_content = content[0]
                    if isinstance(first_content, dict) and "text" in first_content:
                        try:
                            # Parse the text as JSON if possible
                            result = json.loads(first_content["text"])
                        except json.JSONDecodeError:
                            result = first_content["text"]

            return {
                "output": json.dumps(result) if isinstance(result, dict) else str(result),
                "tokenUsage": {"total": 0, "prompt": 0, "completion": 0}
            }

    except httpx.ConnectError as e:
        return {
            "output": json.dumps({
                "error": "Connection failed",
                "message": f"Could not connect to MCP server at {endpoint}: {str(e)}"
            }),
            "error": f"Connection failed: {e}"
        }
    except httpx.TimeoutException as e:
        return {
            "output": json.dumps({
                "error": "Timeout",
                "message": f"Request timed out: {str(e)}"
            }),
            "error": f"Timeout: {e}"
        }
    except Exception as e:
        return {
            "output": json.dumps({
                "error": "Provider error",
                "message": str(e)
            }),
            "error": str(e)
        }


# For synchronous provider calls (if needed)
def call_tool_sync(prompt: str, options: dict, context: dict) -> dict[str, Any]:
    """
    Synchronous wrapper for call_tool.

    Some versions of Promptfoo may call the provider synchronously.
    """
    import asyncio

    # Check if there's a running event loop
    try:
        asyncio.get_running_loop()
        # If we're in an async context, create a new event loop in a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(
                asyncio.run,
                call_tool(prompt, options, context)
            )
            return future.result(timeout=60)
    except RuntimeError:
        # No running event loop, we can use asyncio.run directly
        return asyncio.run(call_tool(prompt, options, context))
