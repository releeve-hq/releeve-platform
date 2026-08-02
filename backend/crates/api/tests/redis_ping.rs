//! Redis connectivity through the `redis` client.

use test_support::spawn_redis;

#[tokio::test]
async fn redis_ping_roundtrips() {
    let instance = spawn_redis().await;

    let client = redis::Client::open(instance.url).expect("redis url parses");
    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("connect to redis testcontainer");

    let pong: String = redis::cmd("PING")
        .query_async(&mut conn)
        .await
        .expect("PING");
    assert_eq!(pong, "PONG");
}
