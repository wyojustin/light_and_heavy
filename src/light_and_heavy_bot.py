#!/usr/bin/env python3
"""
light_and_heavy_bot.py

A bot for the “light_and_heavy” game that uses a trained DQN model
to automatically play over MQTT. The bot prints all MQTT messages
to stdout.

Instructions for porting the trained NN:
1. In Colab, after training your model using Stable Baselines3,
   run:
       model.save("dqn_floating_checkers.zip")
2. Download the file “dqn_floating_checkers.zip” from Colab 
   (using the Files pane or appropriate code) and copy it into
   the same directory as this file on your local machine.
3. Make sure you have installed the required packages on your
   local machine:
       pip install gymnasium stable-baselines3 paho-mqtt
4. Then run this file:
       python light_and_heavy_bot.py
"""

import json
import time
import random
import numpy as np
import gymnasium as gym
import paho.mqtt.client as mqtt
from stable_baselines3 import DQN

# =========================
# Custom Environment Setup
# =========================

# Game parameters
ROWS = 6
COLS = 7
INITIAL_LIGHT = 11
INITIAL_HEAVY = 10

class FloatingCheckersEnv(gym.Env):
    metadata = {"render.modes": ["human"]}
    
    def __init__(self, render_mode=None):
        super(FloatingCheckersEnv, self).__init__()
        self.render_mode = render_mode
        # Define observation bounds: 42 board cells plus 4 remaining counts.
        board_low = np.full((42,), -2, dtype=np.float32)
        board_high = np.full((42,), 2, dtype=np.float32)
        rem_low = np.array([0, 0, 0, 0], dtype=np.float32)
        rem_high = np.array([INITIAL_LIGHT, INITIAL_HEAVY, INITIAL_LIGHT, INITIAL_HEAVY], dtype=np.float32)
        low = np.concatenate([board_low, rem_low])
        high = np.concatenate([board_high, rem_high])
        self.observation_space = gym.spaces.Box(low=low, high=high, dtype=np.float32)
        self.action_space = gym.spaces.Discrete(14)
        self.reset()
    
    def reset(self, seed=None, options=None):
        self.board = [['.' for _ in range(COLS)] for _ in range(ROWS)]
        self.remaining = {
            1: {'light': INITIAL_LIGHT, 'heavy': INITIAL_HEAVY},
            2: {'light': INITIAL_LIGHT, 'heavy': INITIAL_HEAVY}
        }
        self.current_player = 1
        self.done = False
        return self._get_obs(), {}
    
    def _get_obs(self):
        mapping = {'.': 0, 'y': 1, 'Y': 2, 'r': -1, 'R': -2}
        board_arr = np.array([mapping[self.board[r][c]] for r in range(ROWS) for c in range(COLS)], dtype=np.float32)
        rem = np.array([
            self.remaining[1]['light'],
            self.remaining[1]['heavy'],
            self.remaining[2]['light'],
            self.remaining[2]['heavy']
        ], dtype=np.float32)
        return np.concatenate([board_arr, rem])
    
    def render(self, mode="human"):
        if self.render_mode == "human":
            print("Current board:")
            for row in self.board:
                print(" ".join(row))
            print(f"Remaining (P1 light/heavy, P2 light/heavy): {self.remaining[1]['light']}/{self.remaining[1]['heavy']} , {self.remaining[2]['light']}/{self.remaining[2]['heavy']}")
            print(f"Current player: {self.current_player}")

    def step(self, action):
        # This simplified step() method is used only for generating an observation for the NN.
        # In a full implementation, you would update the board state based on moves.
        if self.done:
            return self._get_obs(), 0, True, False, {}
        col = action // 2
        move_type = 'light' if action % 2 == 0 else 'heavy'
        # For this bot, we do not simulate the full game dynamics.
        # Instead, we just decrement the remaining piece count and pretend a move was made.
        if self.remaining[self.current_player][move_type] <= 0:
            self.done = True
            return self._get_obs(), -1, True, False, {"reason": "no remaining pieces"}
        self.remaining[self.current_player][move_type] -= 1
        # For demonstration, we mark the top cell of the chosen column.
        symbol = 'y' if self.current_player == 1 and move_type == 'light' else \
                 'Y' if self.current_player == 1 else \
                 'r' if self.current_player == 2 and move_type == 'light' else 'R'
        for r in range(ROWS):
            if self.board[r][col] == '.':
                self.board[r][col] = symbol
                break
        # Check win condition omitted for brevity.
        # Switch turn
        self.current_player = 2 if self.current_player == 1 else 1
        return self._get_obs(), 0, False, False, {}

# =========================
# Load Trained Model
# =========================

MODEL_PATH = "dqn_floating_checkers.zip"  # Make sure this file is in the same directory.
model = DQN.load(MODEL_PATH)
# Create a local environment instance for generating observations.
env = FloatingCheckersEnv(render_mode="human")

# =========================
# MQTT Bot Setup
# =========================

# MQTT broker settings
MQTT_BROKER = "mqtt.eclipseprojects.io"
MQTT_PORT = 443
MQTT_PATH = "/mqtt"

# MQTT topics
TOPIC_CHALLENGE = "light_and_heavy/challenge"
TOPIC_CHALLENGE_ACCEPTED = "light_and_heavy/challenge_accepted"
TOPIC_MOVE = "light_and_heavy/move"
TOPIC_DRAW = "light_and_heavy/draw"

# Bot configuration
BOT_CLIENT_ID = "bot_" + str(random.randint(1000, 9999))
SHARED_SECRET = "bot"  # Shared secret for identification if needed

def on_connect(client, userdata, flags, rc):
    print("Connected to MQTT broker with result code", rc)
    client.subscribe(TOPIC_CHALLENGE)
    client.subscribe(TOPIC_CHALLENGE_ACCEPTED)
    client.subscribe(TOPIC_MOVE)
    client.subscribe(TOPIC_DRAW)
    # Immediately publish a challenge message on connect.
    publish_challenge(client)

def publish_challenge(client):
    move_number = 1
    nonce = "nonce_" + str(random.randint(10000, 99999))
    msg = {
        "move": move_number,
        "nonce": nonce,
        "clientId": BOT_CLIENT_ID,
        "type": "challenge"
    }
    payload = json.dumps(msg)
    print("Publishing challenge:", payload)
    client.publish(TOPIC_CHALLENGE, payload, qos=0, retain=True)

def publish_challenge_accepted(client):
    move_number = 1
    nonce = "nonce_" + str(random.randint(10000, 99999))
    msg = {
        "move": move_number,
        "nonce": nonce,
        "clientId": BOT_CLIENT_ID,
        "type": "challenge_accepted"
    }
    payload = json.dumps(msg)
    print("Publishing challenge accepted:", payload)
    client.publish(TOPIC_CHALLENGE_ACCEPTED, payload, qos=0, retain=True)

def publish_move(client):
    # Use the bot's local environment to generate an observation.
    # In a full implementation, you would update the environment based on incoming moves.
    obs, _ = env.reset()  # For demonstration, we reset the state.
    action, _states = model.predict(obs, deterministic=True)
    col = action // 2
    move_type = "light" if action % 2 == 0 else "heavy"
    move_nonce = "moveNonce_" + str(random.randint(10000, 99999))
    msg = {
        "move": 1,  # Move number; in a complete implementation, track this properly.
        "col": col,
        "type": move_type,
        "nonce": move_nonce,
        "clientId": BOT_CLIENT_ID
    }
    payload = json.dumps(msg)
    print("Publishing move:", payload)
    client.publish(TOPIC_MOVE, payload, qos=0)

def on_message(client, userdata, msg):
    print("MQTT message received on topic", msg.topic, ":", msg.payload.decode())
    try:
        data = json.loads(msg.payload.decode())
    except Exception as e:
        print("Error parsing message:", e)
        return

    # Process incoming messages:
    if msg.topic == TOPIC_CHALLENGE:
        # If the challenge is from another client, accept it.
        if data.get("clientId") != BOT_CLIENT_ID:
            print("Received challenge from", data.get("clientId"))
            publish_challenge_accepted(client)
    elif msg.topic == TOPIC_CHALLENGE_ACCEPTED:
        if data.get("clientId") != BOT_CLIENT_ID:
            print("Received challenge accepted from", data.get("clientId"))
    elif msg.topic == TOPIC_MOVE:
        print("Received move message:", data)
        # Optionally, update your internal game state.
        # Then, if it's our turn, decide on a move.
        time.sleep(1)  # Simulate some delay.
        publish_move(client)
    elif msg.topic == TOPIC_DRAW:
        print("Received draw message.")

def main():
    client = mqtt.Client(client_id=BOT_CLIENT_ID, transport="websockets")
    client.on_connect = on_connect
    client.on_message = on_message

    # Enable TLS/SSL for secure connection.
    client.tls_set()
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_forever()

if __name__ == "__main__":
    main()
