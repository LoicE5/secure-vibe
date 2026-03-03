FROM ubuntu:latest

RUN apt update
RUN apt install git curl build-essential -y

RUN curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash

RUN brew update && brew install gcc bun