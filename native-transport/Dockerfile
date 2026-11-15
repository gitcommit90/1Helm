FROM golang:1.27.1-bookworm AS build
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go mod verify && sh patch-tailscale.sh
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /native-transport .
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /native-transport /native-transport
EXPOSE 8787
ENTRYPOINT ["/native-transport"]
