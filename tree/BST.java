// =============================================================
//  Binary Search Tree (BST)  -  CPCS204 Data Structures I
//  Build the node, insert, search, find min / max,
//  and delete (leaf, one child, two children).
// =============================================================

// ---------- 1) The Node ----------
class Node {
    int data;      // the value stored in the node
    Node left;     // reference to the left child  (smaller values)
    Node right;    // reference to the right child (larger values)

    Node(int data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}

// ---------- 2) The Tree ----------
public class BST {

    Node root;     // the tree starts EMPTY

    BST() {
        root = null;
    }

    // ---------- 3) INSERT ----------
    public void insert(int value) {
        root = insert(root, value);
    }

    private Node insert(Node node, int value) {
        if (node == null) {                 // empty spot found
            return new Node(value);         // create the new node here
        }
        if (value < node.data) {            // smaller -> go LEFT
            node.left = insert(node.left, value);
        } else if (value > node.data) {     // larger  -> go RIGHT
            node.right = insert(node.right, value);
        }
        // value == node.data : duplicate, do nothing
        return node;
    }

    // ---------- 4) SEARCH ----------
    public boolean search(int key) {
        return search(root, key);
    }

    private boolean search(Node node, int key) {
        if (node == null)      return false;              // reached null: NOT found
        if (key == node.data)  return true;               // FOUND
        if (key < node.data)   return search(node.left, key);   // go left
        else                   return search(node.right, key);  // go right
    }

    // ---------- 5) MINIMUM and MAXIMUM ----------
    // Minimum: keep going LEFT until left is null
    Node findMin(Node node) {
        while (node.left != null) {
            node = node.left;
        }
        return node;
    }

    // Maximum: keep going RIGHT until right is null
    Node findMax(Node node) {
        while (node.right != null) {
            node = node.right;
        }
        return node;
    }

    // ---------- 6) DELETE (uses the SUCCESSOR = min of right subtree) ----------
    public void delete(int key) {
        root = delete(root, key);
    }

    private Node delete(Node node, int key) {
        if (node == null) return null;                    // key not in the tree

        if (key < node.data) {
            node.left = delete(node.left, key);           // search left
        } else if (key > node.data) {
            node.right = delete(node.right, key);         // search right
        } else {
            // ===== node.data == key : this is the node to delete =====

            // CASE 1: no children (leaf)  -> just remove it
            if (node.left == null && node.right == null) {
                return null;
            }

            // CASE 2: one child  -> the child takes the node's place
            if (node.left == null) {
                return node.right;                        // only a right child
            }
            if (node.right == null) {
                return node.left;                         // only a left child
            }

            // CASE 3: two children
            //   a) find the successor = MINIMUM of the RIGHT subtree
            Node successor = findMin(node.right);
            //   b) copy its value into this node
            node.data = successor.data;
            //   c) delete the successor from the right subtree
            node.right = delete(node.right, successor.data);
        }
        return node;
    }

    // ---------- 6b) DELETE (uses the PREDECESSOR = max of left subtree) ----------
    public void deleteUsingPredecessor(int key) {
        root = deleteP(root, key);
    }

    private Node deleteP(Node node, int key) {
        if (node == null) return null;

        if (key < node.data) {
            node.left = deleteP(node.left, key);
        } else if (key > node.data) {
            node.right = deleteP(node.right, key);
        } else {
            if (node.left == null && node.right == null) return null;   // CASE 1
            if (node.left == null)  return node.right;                  // CASE 2
            if (node.right == null) return node.left;                   // CASE 2

            // CASE 3: two children
            //   a) find the predecessor = MAXIMUM of the LEFT subtree
            Node predecessor = findMax(node.left);
            //   b) copy its value into this node
            node.data = predecessor.data;
            //   c) delete the predecessor from the left subtree
            node.left = deleteP(node.left, predecessor.data);
        }
        return node;
    }

    // ---------- In-order print (gives SORTED order) ----------
    void inOrder(Node node) {
        if (node == null) return;
        inOrder(node.left);
        System.out.print(node.data + " ");
        inOrder(node.right);
    }

    void preOrder(Node node) {
        if (node == null) return;
        System.out.print(node.data + " ");
        preOrder(node.left);
        preOrder(node.right);
    }

    void print(String title) {
        System.out.print(title + "  in-order: ");
        inOrder(root);
        System.out.print("  | pre-order: ");
        preOrder(root);
        System.out.println();
    }

    // ---------- Demo ----------
    static BST build(int[] keys) {
        BST t = new BST();
        for (int k : keys) t.insert(k);
        return t;
    }

    public static void main(String[] args) {
        int[] keys = {50, 30, 70, 20, 40, 60, 80, 65};

        BST t = build(keys);
        t.print("Built tree              ");
        System.out.println("search(60) = " + t.search(60));   // true
        System.out.println("search(45) = " + t.search(45));   // false
        System.out.println("min = " + t.findMin(t.root).data
                       + ", max = " + t.findMax(t.root).data); // 20, 80

        // each case starts again from the SAME original tree
        BST a = build(keys); a.delete(20);
        a.print("Case 1 leaf: delete 20  ");
        BST b = build(keys); b.delete(60);
        b.print("Case 2 one child: del 60");
        BST c = build(keys); c.delete(50);
        c.print("Case 3 successor: del 50");                 // 60 replaces 50
        BST d = build(keys); d.deleteUsingPredecessor(50);
        d.print("Case 3 predecessor: 50  ");                 // 40 replaces 50
    }
}
