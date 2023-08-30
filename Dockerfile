FROM alpine:latest

RUN apk update
RUN apk add lighttpd
RUN rm -rf /var/cache/apk/*

COPY dist/ /var/www/localhost/htdocs

CMD ["lighttpd","-D","-f","/etc/lighttpd/lighttpd.conf"]
