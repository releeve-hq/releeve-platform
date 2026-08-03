#[tokio::test]
async fn churn_exp() {
    let redis = test_support::spawn_redis().await;
    let client = redis::Client::open(redis.url.clone()).unwrap();
    for i in 0..60 {
        let s = std::time::Instant::now();
        let mut c = client.get_multiplexed_async_connection().await.unwrap();
        let dt = s.elapsed();
        let _: () = redis::cmd("PING").query_async(&mut c).await.unwrap();
        if i % 10 == 0 || dt.as_millis() > 100 {
            eprintln!("conn {i}: open {:?}", dt);
        }
        drop(c);
    }
}
