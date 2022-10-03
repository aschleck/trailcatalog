FROM alpine:3
RUN apk add --no-cache aria2
RUN adduser -D app
USER app
ENTRYPOINT ["aria2c"]
