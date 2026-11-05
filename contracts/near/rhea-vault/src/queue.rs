use near_sdk::{collections::LookupMap, near};

pub const NONE: u64 = u64::MAX;

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Node {
    pub user: String,
    pub amount: u128,
    pub next: u64,
}

#[near(serializers = [borsh])]
pub struct Queue {
    pub head: u64,
    tail: u64,
    next_id: u64,
    pub nodes: LookupMap<u64, Node>,
}

impl Queue {
    pub fn new(prefix: &[u8]) -> Self {
        Self {
            head: NONE,
            tail: NONE,
            next_id: 0,
            nodes: LookupMap::new(prefix.to_vec()),
        }
    }
    pub fn append(&mut self, user: String, amount: u128) -> u64 {
        let id = self.next_id;
        self.next_id = id.checked_add(1).expect("queue id overflow");
        self.nodes.insert(
            &id,
            &Node {
                user,
                amount,
                next: NONE,
            },
        );
        self.requeue(id, amount);
        id
    }
    pub fn requeue(&mut self, id: u64, amount: u128) {
        let mut node = self.nodes.get(&id).expect("missing reserved queue node");
        node.amount = amount;
        node.next = NONE;
        self.nodes.insert(&id, &node);
        if self.tail == NONE {
            self.head = id;
        } else {
            let mut tail = self.nodes.get(&self.tail).expect("missing queue tail");
            tail.next = id;
            self.nodes.insert(&self.tail, &tail);
        }
        self.tail = id;
    }
    pub fn first(&self, limit: usize) -> Vec<u64> {
        let mut ids = Vec::new();
        let mut id = self.head;
        while id != NONE && ids.len() < limit {
            ids.push(id);
            id = self.nodes.get(&id).expect("missing queue node").next;
        }
        ids
    }
    pub fn detach(&mut self, id: u64) {
        let node = self.nodes.get(&id).expect("missing queue node");
        if self.head == id {
            self.head = node.next;
        } else {
            let mut previous = self.head;
            while previous != NONE {
                let mut before = self
                    .nodes
                    .get(&previous)
                    .expect("missing queue predecessor");
                if before.next == id {
                    before.next = node.next;
                    self.nodes.insert(&previous, &before);
                    break;
                }
                previous = before.next;
            }
            assert!(previous != NONE, "node not queued");
        }
        if self.tail == id {
            self.tail = self.head;
            while self.tail != NONE {
                let tail = self.nodes.get(&self.tail).expect("missing queue tail");
                if tail.next == NONE {
                    break;
                }
                self.tail = tail.next;
            }
        }
        let mut detached = node;
        detached.next = NONE;
        self.nodes.insert(&id, &detached);
    }
}
