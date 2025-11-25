#!/bin/bash

# Exit immediately if any command fails
set -e

echo "--- Ecosystem Sentry ---"
echo "Starting test for: $PACKAGE_NAME on $NODE_VERSION"

# We will put our final PASS/FAIL result in this file
STATUS="FAIL"
START_TIME=$(date -u +%s)

# --- This 'try/catch' block is the core of our test ---
# We use '&&' (AND) to chain the commands.
# If ANY of them fail, the chain stops and jumps to the 'catch' block.
(
    echo "Step 1: Pulling new Docker image: $NODE_VERSION"
    # Pull the new Node.js version
    docker pull $NODE_VERSION

    echo "Step 2: Starting container and cloning $PACKAGE_NAME"
    # Start a container and run a command inside it to clone the package
    # We set a 5-minute timeout in case 'git clone' gets stuck
    timeout 300s docker run --rm --workdir /app $NODE_VERSION \
      bash -c "git clone https://github.com/$(npm view $PACKAGE_NAME repository.url | sed 's/git+//; s/\.git//') ."

    echo "Step 3: Running 'npm ci' (Testing dependencies)"
    # Run 'npm ci' (Clean Install) inside the *same* container
    # This is TEST #1: Can this new Node.js version install all dependencies?
    # This is what catches the 'node-gyp' (C++) failures.
    # We set a 10-minute timeout in case 'npm ci' gets stuck
    timeout 600s docker run --rm --workdir /app $NODE_VERSION npm ci

    echo "Step 4: Running 'npm test' (Testing the package)"
    # Run the package's *own* test suite
    # This is TEST #2: Does the package *work* on this new Node.js version?
    # We set a 10-minute timeout for the tests
    timeout 600s docker run --rm --workdir /app $NODE_VERSION npm test

    # If we made it this far, all steps passed!
    echo "SUCCESS: $PACKAGE_NAME passed all tests."
    STATUS="PASS"

) || (
    # This 'catch' block runs if *any* of the commands above failed
    echo "FAILURE: $PACKAGE_NAME failed the test."
    STATUS="FAIL"
)
# --- End of 'try/catch' block ---


# --- Part 3: The "Reporter" ---
echo "Step 5: Generating 'deployment' artifact (result.json)"
END_TIME=$(date -u +%s)
DURATION=$((END_TIME - START_TIME))

# Create our final JSON report file.
# The 'sentry.yml' file will pick this up and upload it.
echo '{
  "package": "'"$PACKAGE_NAME"'",
  "node_version": "'"$NODE_VERSION"'",
  "status": "'"$STATUS"'",
  "duration_seconds": '"$DURATION"',
  "timestamp": "'"$START_TIME"'"
}' > result.json

echo "--- Test Complete ---"
